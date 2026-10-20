package testapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/routers"
	"github.com/oasdiff/yaml"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"gripello/internal/platform"
)

// APIDir holds the OpenAPI fragments, relative to a package directory two levels below backend/.
const APIDir = "../../../api"

var pathParam = regexp.MustCompile(`\{[^}]*\}`)

// RouteKey normalizes "GET /api/gyms/{gym}" and "GET /gyms/{id}" to the same key.
func RouteKey(method, path string) string {
	path = strings.TrimPrefix(path, "/api")
	return method + " " + pathParam.ReplaceAllString(path, "{}")
}

type Spec struct {
	File string
	Doc  *openapi3.T
}

var (
	contractOnce sync.Once
	contractOps  map[string]*routers.Route
	contractDocs []Spec
	contractErr  error
	specFiles    = map[*openapi3.T]string{}
)

// Contract loads and validates every api/*.yaml once and indexes their operations by RouteKey.
func Contract() ([]Spec, map[string]*routers.Route, error) {
	contractOnce.Do(func() {
		contractDocs, contractOps, contractErr = loadContract(APIDir)
	})
	return contractDocs, contractOps, contractErr
}

func loadContract(dir string) ([]Spec, map[string]*routers.Route, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.yaml"))
	if err != nil || len(files) == 0 {
		return nil, nil, fmt.Errorf("no OpenAPI files in %s: %v", dir, err)
	}
	ops := map[string]*routers.Route{}
	var docs []Spec
	var failures []error
	for _, file := range files {
		loader := openapi3.NewLoader()
		loader.IsExternalRefsAllowed = true
		doc, err := loader.LoadFromFile(file)
		if err == nil {
			err = doc.Validate(context.Background())
		}
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", filepath.Base(file), err))
			continue
		}
		docs = append(docs, Spec{File: filepath.Base(file), Doc: doc})
		specFiles[doc] = filepath.Base(file)
		for path, item := range doc.Paths.Map() {
			for method, op := range item.Operations() {
				key := RouteKey(method, path)
				if ops[key] != nil {
					failures = append(failures, fmt.Errorf("%s: %s is documented twice", filepath.Base(file), key))
				}
				ops[key] = &routers.Route{Spec: doc, Path: path, PathItem: item, Method: method, Operation: op}
			}
		}
	}
	return docs, ops, errors.Join(failures...)
}

var testsByApp sync.Map

type teeWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (w *teeWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *teeWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (w *teeWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *teeWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// validateResponses fails t whenever a documented route answers with a status or JSON body its spec doesn't allow.
func validateResponses(t testing.TB, app *platform.App, next http.Handler) http.Handler {
	_, ops, err := Contract()
	if err != nil {
		t.Fatalf("api contract: %v", err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tee := &teeWriter{ResponseWriter: w}
		next.ServeHTTP(tee, r)
		_, pattern := app.Mux.Handler(r)
		method, path, _ := strings.Cut(pattern, " ")
		route := ops[RouteKey(method, path)]
		if route == nil || tee.status == 0 || tee.status == 499 || r.Method == http.MethodHead {
			return
		}
		mediaType, _, _ := mime.ParseMediaType(tee.Header().Get("Content-Type"))
		if err := CheckResponse(route, tee.status, mediaType, tee.body.Bytes()); err != nil {
			t.Errorf("api contract: %s %s (%s) answered %d: %v\nbody: %.600s", r.Method, r.URL.Path, route.Operation.OperationID, tee.status, err, tee.body.String())
		}
	})
}

// CheckResponse validates a status and body against the operation route documents.
func CheckResponse(route *routers.Route, status int, mediaType string, body []byte) error {
	code := strconv.Itoa(status)
	response := route.Operation.Responses.Value(code)
	if response == nil {
		code = "default"
		response = route.Operation.Responses.Value(code)
	}
	if response == nil && status == http.StatusInternalServerError {
		return nil
	}
	if response == nil {
		return fmt.Errorf("status %d is not documented", status)
	}
	if mediaType != "application/json" || response.Value == nil || response.Value.Content.Get("application/json") == nil {
		return nil
	}
	file, _ := filepath.Abs(filepath.Join(APIDir, specFiles[route.Spec]))
	location := "file://" + file + "#/paths/" + pointerToken(route.Path) + "/" + strings.ToLower(route.Method) + "/responses/" + code
	if response.Ref != "" {
		ref, fragment, _ := strings.Cut(response.Ref, "#")
		if ref != "" {
			file = filepath.Join(filepath.Dir(file), ref)
		}
		location = "file://" + file + "#" + fragment
	}
	schema, err := compileSchema(location + "/content/application~1json/schema")
	if err != nil {
		return err
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("body is not JSON: %w", err)
	}
	if err := schema.Validate(value); err != nil {
		return fmt.Errorf("%#v", err)
	}
	return strayTimestamp(value, "")
}

var (
	canonicalTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
	looksLikeTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}[ Tt]\d{2}:\d{2}`)
	canonicalDay       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// userText holds what climbers type; apitime.Canonical leaves it alone even when it reads like a timestamp.
var userText = map[string]bool{"name": true, "route_name": true, "comment": true, "description": true, "note": true, "title": true}

// strayTimestamp finds timestamps the spec doesn't mark as date-time, e.g. inside free-form records.
func strayTimestamp(value any, at string) error {
	switch v := value.(type) {
	case string:
		if looksLikeTimestamp.MatchString(v) && !canonicalTimestamp.MatchString(v) {
			return fmt.Errorf("%s: timestamp %q is not RFC 3339 UTC with milliseconds", at, v)
		}
	case map[string]any:
		for key, item := range v {
			if userText[key] {
				continue
			}
			if err := strayTimestamp(item, at+"/"+key); err != nil {
				return err
			}
		}
	case []any:
		for i, item := range v {
			if err := strayTimestamp(item, at+"/"+strconv.Itoa(i)); err != nil {
				return err
			}
		}
	}
	return nil
}

func timeFormat(name string, valid *regexp.Regexp, layout string) *jsonschema.Format {
	return &jsonschema.Format{Name: name, Validate: func(v any) error {
		s, ok := v.(string)
		if !ok {
			return nil
		}
		if _, err := time.Parse(layout, s); err != nil || !valid.MatchString(s) {
			return fmt.Errorf("%q is not a %s in the API's format", s, name)
		}
		return nil
	}}
}

func pointerToken(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

type yamlLoader struct{}

func (yamlLoader) Load(url string) (any, error) {
	raw, err := os.ReadFile(strings.TrimPrefix(url, "file://"))
	if err != nil {
		return nil, err
	}
	asJSON, err := yaml.YAMLToJSON(raw)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(asJSON))
}

var (
	compilerMu sync.Mutex
	compiler   *jsonschema.Compiler
	compiled   = map[string]*jsonschema.Schema{}
)

// compileSchema uses JSON Schema 2020-12 directly: kin-openapi's validator can't follow recursive component refs and falls back to OpenAPI 3.0 nullability.
func compileSchema(location string) (*jsonschema.Schema, error) {
	compilerMu.Lock()
	defer compilerMu.Unlock()
	if schema, ok := compiled[location]; ok {
		return schema, nil
	}
	if compiler == nil {
		compiler = jsonschema.NewCompiler()
		compiler.DefaultDraft(jsonschema.Draft2020)
		compiler.AssertFormat()
		for _, unchecked := range []string{"email", "uri"} {
			compiler.RegisterFormat(&jsonschema.Format{Name: unchecked, Validate: func(any) error { return nil }})
		}
		compiler.RegisterFormat(timeFormat("date-time", canonicalTimestamp, time.RFC3339Nano))
		compiler.RegisterFormat(timeFormat("date", canonicalDay, time.DateOnly))
		compiler.UseLoader(jsonschema.SchemeURLLoader{"file": yamlLoader{}})
	}
	schema, err := compiler.Compile(location)
	if err != nil {
		return nil, err
	}
	compiled[location] = schema
	return schema, nil
}
