package httpx

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRejectsNULButKeepsEscapedBackslashes(t *testing.T) {
	cases := map[string]bool{
		`{"name":"a\u0000b"}`:                           false,
		`{"name":"\\\u0000"}`:                           false,
		`{"name":"\\u0000"}`:                            true,
		`{"name":"\\\\u0000"}`:                          true,
		`{"name":"🧗 Crimp"}`:                            true,
		`{"name":`:                                      false,
		`{"name":"` + strings.Repeat("x", 1<<20) + `"}`: false,
	}
	for body, ok := range cases {
		var v struct{ Name string }
		err := Decode(httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), &v)
		if (err == nil) != ok {
			t.Errorf("%.40s: err = %v, want ok %v", body, err, ok)
		}
	}
}

func TestBlank(t *testing.T) {
	for _, s := range []string{"", "   ", "\u200b", " \u200b\u200d\ufeff ", "\t\n", "\u3164", "\u2800", "\u00a0"} {
		if !Blank(s) {
			t.Errorf("%q should be blank", s)
		}
	}
	for _, s := range []string{"a", " Crimp ", "🧗", "\u200bx", "ü"} {
		if Blank(s) {
			t.Errorf("%q is not blank", s)
		}
	}
}

func TestNULInQueryOrFormIsABadRequest(t *testing.T) {
	reached := false
	handler := Handler(func(w http.ResponseWriter, r *http.Request) error {
		reached = true
		return nil
	})
	for _, target := range []string{"/?q=a%00b", "/?a%00=1", "/x%00y"} {
		reached = false
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusBadRequest || reached {
			t.Errorf("%s = %d, handler reached %v", target, recorder.Code, reached)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/?q=%2500", nil))
	if recorder.Code != http.StatusOK || !reached {
		t.Errorf("an escaped percent sign = %d", recorder.Code)
	}

	form := func(fields map[string]string) *http.Request {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for name, value := range fields {
			writer.WriteField(name, value)
		}
		writer.Close()
		r := httptest.NewRequest(http.MethodPost, "/", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		return r
	}
	for name, fields := range map[string]map[string]string{
		"raw NUL":         {"description": "a\x00b"},
		"escaped in JSON": {"@jsonPayload": `{"name":"a\u0000b"}`},
	} {
		if err := CheckForm(form(fields)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if err := CheckForm(form(map[string]string{"@jsonPayload": `{"name":"\\u0000"}`, "description": "🧗"})); err != nil {
		t.Errorf("clean form refused: %v", err)
	}
	if err := CheckForm(httptest.NewRequest(http.MethodPost, "/", nil)); err != nil {
		t.Errorf("unparsed request refused: %v", err)
	}
}
