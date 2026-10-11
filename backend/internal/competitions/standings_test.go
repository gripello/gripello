package competitions

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
)

func TestStandingsMatchFixture(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/competitionStandings.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Defaults struct {
			TopPool            float64   `json:"topPool"`
			AttemptFactors     []float64 `json:"attemptFactors"`
			TopropeFactor      float64   `json:"topropeFactor"`
			IfscTopPoints      float64   `json:"ifscTopPoints"`
			IfscZonePoints     float64   `json:"ifscZonePoints"`
			IfscAttemptPenalty float64   `json:"ifscAttemptPenalty"`
		} `json:"defaults"`
		Cases []struct {
			Name  string `json:"name"`
			Input struct {
				Competition Competition `json:"competition"`
				Categories  []Category  `json:"categories"`
				Entries     []Standing  `json:"entries"`
				Routes      []CompRoute `json:"routes"`
				Scores      []Score     `json:"scores"`
			} `json:"input"`
			Standings []CategoryStanding `json:"standings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	d := fixture.Defaults
	if d.TopPool != defaultTopPool || !slices.Equal(d.AttemptFactors, defaultAttemptFactors) || d.TopropeFactor != defaultTopropeFactor ||
		d.IfscTopPoints != ifscTopPoints || d.IfscZonePoints != ifscZonePoints || d.IfscAttemptPenalty != ifscAttemptPenalty {
		t.Errorf("defaults differ from the fixture: %+v", d)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no fixture cases")
	}
	for _, c := range fixture.Cases {
		in := c.Input
		got := buildStandings(in.Competition, in.Categories, in.Entries, in.Routes, in.Scores)
		if !reflect.DeepEqual(got, c.Standings) {
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(c.Standings)
			t.Errorf("%s:\n got %s\nwant %s", c.Name, gotJSON, wantJSON)
		}
	}
}
