package main

import (
	"slices"
	"strings"
	"testing"

	"gripello/internal/platform/testapp"
)

var undocumentedRoutes = map[string]string{
	"GET /realtime": "server-sent event stream, documented by the realtime protocol rather than a response schema",
}

func TestEveryRouteIsDocumented(t *testing.T) {
	app := testapp.App(t)
	mount(app, func() bool { return false })
	_, ops, err := testapp.Contract()
	if err != nil {
		t.Fatal(err)
	}
	registered := map[string]bool{}
	for _, route := range app.Routes {
		method, path, _ := strings.Cut(route, " ")
		key := testapp.RouteKey(method, path)
		registered[key] = true
		if ops[key] == nil && undocumentedRoutes[key] == "" {
			t.Errorf("%s is registered but not in api/*.yaml", route)
		}
		if ops[key] != nil && undocumentedRoutes[key] != "" {
			t.Errorf("%s is documented, drop it from undocumentedRoutes", route)
		}
	}
	var missing []string
	for key, route := range ops {
		if !registered[key] {
			missing = append(missing, key+" ("+route.Operation.OperationID+")")
		}
	}
	slices.Sort(missing)
	for _, key := range missing {
		t.Errorf("%s is documented but not registered", key)
	}
}

func TestResponseCheckCatchesDrift(t *testing.T) {
	_, ops, err := testapp.Contract()
	if err != nil {
		t.Fatal(err)
	}
	health := ops[testapp.RouteKey("GET", "/health")]
	if err := testapp.CheckResponse(health, 200, "application/json", []byte(`{"version":"dev","status":"ok","database":"ok"}`)); err != nil {
		t.Errorf("valid body rejected: %v", err)
	}
	if err := testapp.CheckResponse(health, 200, "application/json", []byte(`{"version":1,"status":"ok","database":"ok"}`)); err == nil {
		t.Error("wrong type passed")
	}
	if err := testapp.CheckResponse(health, 418, "application/json", []byte(`{}`)); err == nil {
		t.Error("undocumented status passed")
	}
	if err := testapp.CheckResponse(ops[testapp.RouteKey("GET", "/online")], 401, "application/json", []byte(`{"message":"x"}`)); err == nil {
		t.Error("error body without status and data passed")
	}
}
