package main

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"gripello/internal/platform/testapp"
)

var (
	megabyte    = strings.Repeat("x", 1<<20-64)
	emojiString = "🧗\u200d♀️\u200b\u202eｅｍｏｊｉ\U0001F9D7🏽 \x00"
)

func wrongType(schema *openapi3.Schema) any {
	switch {
	case schema.Type.Is("string"):
		return 12345
	case schema.Type.Is("array"):
		return map[string]any{"x": 1}
	case schema.Type.Is("object"):
		return []any{1}
	}
	return "not-a-number"
}

func junkBodies(schema *openapi3.Schema) []string {
	bodies := []string{`{`, `[]`, `null`, `"x"`, `{"unknown":1}`, `{"a":` + strings.Repeat("[", 10000) + `}`}
	if schema == nil {
		return bodies
	}
	names := slices.Sorted(func(yield func(string) bool) {
		for name := range schema.Properties {
			if !yield(name) {
				return
			}
		}
	})
	for _, name := range names {
		property := schema.Properties[name]
		if property == nil || property.Value == nil {
			continue
		}
		for _, value := range []any{wrongType(property.Value), nil, megabyte, emojiString, -1, 1e300} {
			raw, _ := json.Marshal(map[string]any{name: value})
			bodies = append(bodies, string(raw))
		}
	}
	return bodies
}

func requestSchema(op *openapi3.Operation) *openapi3.Schema {
	if op.RequestBody == nil || op.RequestBody.Value == nil {
		return nil
	}
	media := op.RequestBody.Value.Content.Get("application/json")
	if media == nil || media.Schema == nil {
		return nil
	}
	return media.Schema.Value
}

func TestJunkBodiesNeverCrash(t *testing.T) {
	_, ops, err := testapp.Contract()
	if err != nil {
		t.Fatal(err)
	}
	for _, caller := range []string{"platform", "adminA", "climber"} {
		t.Run(caller, func(t *testing.T) {
			t.Parallel()
			w := newWorld(t)
			for _, route := range writeRoutes(w.app) {
				method, pattern, _ := strings.Cut(route, " ")
				op := ops[testapp.RouteKey(method, pattern)]
				if op == nil || (method == http.MethodDelete && op.Operation.RequestBody == nil) {
					continue
				}
				for _, body := range junkBodies(requestSchema(op.Operation)) {
					response := w.call(caller, method, w.path(pattern), body)
					if response.Code >= 500 {
						t.Errorf("%s with %.80s answered %d: %s", route, body, response.Code, response.Body)
					}
				}
			}
		})
	}
}
