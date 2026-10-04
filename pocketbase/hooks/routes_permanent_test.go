package hooks

import (
	"strings"
	"testing"
)

func TestRouteViewExposesPermanent(t *testing.T) {
	app := newGymTestApp(t)
	defer app.Cleanup()

	routes, err := app.FindCollectionByNameOrId("routes")
	if err != nil {
		t.Fatal(err)
	}
	if routes.Fields.GetByName("permanent") == nil {
		t.Fatal("routes.permanent missing")
	}
	view, err := app.FindCollectionByNameOrId("averageRating")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(view.ViewQuery, "routes.permanent") || view.Fields.GetByName("permanent") == nil {
		t.Fatalf("averageRating view lacks permanent: %s", view.ViewQuery)
	}
}
