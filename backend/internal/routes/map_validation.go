package routes

import (
	"encoding/json"
	"math"

	"gripello/internal/platform/httpx"
)

const (
	minMapSize        = 5.0
	maxMapSize        = 500.0
	maxMapShapes      = 300
	maxShapePoints    = 200
	mapShapeMinPoints = 3
	wallEdgeMinPoints = 2
)

var mapShapeKinds = map[string]bool{"floor": true, "mat": true, "structure": true}

type mapPoint [2]float64

type mapShape struct {
	Kind   string     `json:"kind"`
	Points []mapPoint `json:"points"`
}

type gymMap struct {
	Width  float64    `json:"width"`
	Height float64    `json:"height"`
	Shapes []mapShape `json:"shapes"`
}

func parseGymMap(raw json.RawMessage) (*gymMap, error) {
	if isEmptyJSON(raw) {
		return nil, nil
	}
	var floorPlan gymMap
	if json.Unmarshal(raw, &floorPlan) != nil || !validGymMap(&floorPlan) {
		return nil, httpx.NewError(400, "Invalid floor plan.").Field("map", "validation_invalid_map", "Invalid floor plan.")
	}
	return &floorPlan, nil
}

func validateWallShape(w *wallInput, floorPlan *gymMap) error {
	if floorPlan == nil {
		return httpx.NewError(400, "Draw the floor plan before adding walls.")
	}
	var outline, edge []mapPoint
	if json.Unmarshal(w.Outline, &outline) != nil || !validPath(outline, mapShapeMinPoints, floorPlan) {
		return httpx.NewError(400, "Invalid wall outline.").Field("outline", "validation_invalid_outline", "Invalid wall outline.")
	}
	if json.Unmarshal(w.Edge, &edge) != nil || !validPath(edge, wallEdgeMinPoints, floorPlan) || pathLength(edge) == 0 {
		return httpx.NewError(400, "Invalid wall edge.").Field("edge", "validation_invalid_edge", "Invalid wall edge.")
	}
	if !isEmptyJSON(w.Label) {
		var point mapPoint
		if json.Unmarshal(w.Label, &point) != nil || !pointInMap(point, floorPlan) {
			return httpx.NewError(400, "Invalid wall label.").Field("label", "validation_invalid_label", "Invalid wall label.")
		}
	}
	return nil
}

func validGymMap(floorPlan *gymMap) bool {
	if !inRange(floorPlan.Width, minMapSize, maxMapSize) || !inRange(floorPlan.Height, minMapSize, maxMapSize) {
		return false
	}
	if len(floorPlan.Shapes) > maxMapShapes {
		return false
	}
	for _, shape := range floorPlan.Shapes {
		if !mapShapeKinds[shape.Kind] || !validPath(shape.Points, mapShapeMinPoints, floorPlan) {
			return false
		}
	}
	return true
}

func validPath(points []mapPoint, minPoints int, floorPlan *gymMap) bool {
	if len(points) < minPoints || len(points) > maxShapePoints {
		return false
	}
	for _, point := range points {
		if !pointInMap(point, floorPlan) {
			return false
		}
	}
	return true
}

func pointInMap(point mapPoint, floorPlan *gymMap) bool {
	return inRange(point[0], 0, floorPlan.Width) && inRange(point[1], 0, floorPlan.Height)
}

func pathLength(points []mapPoint) float64 {
	length := 0.0
	for index := 1; index < len(points); index++ {
		length += math.Hypot(points[index][0]-points[index-1][0], points[index][1]-points[index-1][1])
	}
	return length
}

func inRange(value, min, max float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= min && value <= max
}

func clampUnit(value float64) float64 {
	if math.IsNaN(value) {
		return 0
	}
	return math.Min(1, math.Max(0, value))
}

func isEmptyJSON(raw json.RawMessage) bool {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return len(raw) == 0
	}
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return v == ""
	case map[string]any:
		return len(v) == 0
	case []any:
		return len(v) == 0
	}
	return false
}
