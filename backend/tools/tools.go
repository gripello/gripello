//go:build tools

// Blank imports keep the tools as direct requirements: Dependabot leaves indirect ones alone.
package tools

import (
	_ "github.com/air-verse/air"
	_ "github.com/google/go-licenses/v2"
	_ "gotest.tools/gotestsum"
)
