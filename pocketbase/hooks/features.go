package hooks

import (
	"reflect"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Mirrored in shared/utils/featureFlags.ts.
const featureBetaVideos = "beta_videos"

func gymFeatures(gym *core.Record) map[string]bool {
	features := map[string]bool{}
	_ = gym.UnmarshalJSONField("features", &features)
	return features
}

func gymHasFeature(app core.App, gymID, feature string) bool {
	gym, err := app.FindRecordById("gyms", gymID)
	return err == nil && gymFeatures(gym)[feature]
}

// Compares the stored JSON values, not their bool reading: SQL rules treat 1 like true.
func featuresChanged(gym *core.Record) bool {
	var before, after map[string]any
	_ = gym.Original().UnmarshalJSONField("features", &before)
	_ = gym.UnmarshalJSONField("features", &after)
	return (len(before) > 0 || len(after) > 0) && !reflect.DeepEqual(before, after)
}

func validateFeatures(e *core.RecordEvent) error {
	var features map[string]any
	if err := e.Record.UnmarshalJSONField("features", &features); err != nil {
		return apis.NewBadRequestError("Feature flags must be an object of true/false values.", nil)
	}
	for _, value := range features {
		if _, ok := value.(bool); !ok {
			return apis.NewBadRequestError("Feature flags must be an object of true/false values.", nil)
		}
	}
	return e.Next()
}
