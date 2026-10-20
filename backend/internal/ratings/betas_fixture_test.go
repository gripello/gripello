package ratings

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func TestBetaVideoFixture(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/betaVideos.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Hosts    []string        `json:"hosts"`
		Types    []string        `json:"types"`
		MaxBytes int64           `json:"maxBytes"`
		Links    map[string]bool `json:"links"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(fixture.Hosts, betaVideoHosts) {
		t.Errorf("hosts = %v, fixture %v", betaVideoHosts, fixture.Hosts)
	}
	if !slices.Equal(fixture.Types, betaVideoTypes) {
		t.Errorf("types = %v, fixture %v", betaVideoTypes, fixture.Types)
	}
	if fixture.MaxBytes != maxBetaBytes {
		t.Errorf("max bytes = %d, fixture %d", maxBetaBytes, fixture.MaxBytes)
	}
	for link, want := range fixture.Links {
		if got := isBetaVideoLink(link); got != want {
			t.Errorf("isBetaVideoLink(%q) = %v, want %v", link, got, want)
		}
	}
}
