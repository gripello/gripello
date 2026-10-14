package gyms

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"
)

// Mirrored in shared/utils/privacyDoc.ts (fixture testdata/privacyDoc.json).
var privacyBlockKeys = []string{
	"controller", "contact", "storage", "rights",
	"scope", "serverLogs", "accounts", "privacySettings", "logbook", "friends", "profiles", "leaderboards",
	"ratings", "betaVideos", "achievements", "competitions", "defects", "reports", "notifications", "push",
	"dataExport", "deletion", "auditLog", "captcha", "map", "thirdParties",
}
var requiredPrivacyBlocks = []string{"controller", "rights"}

const (
	// A built-in section is a top-level paragraph holding one mention of it.
	privacyBlockMention = "mention"
	// Characters of the compact document.
	maxPrivacyDoc = 100000
)

type richTextNode struct {
	Type    string         `json:"type"`
	Text    *string        `json:"text"`
	Attrs   map[string]any `json:"attrs"`
	Content []richTextNode `json:"content"`
}

// privacyBlockKey returns the section a node places, or ok=false for the gym's own text.
func privacyBlockKey(node richTextNode) (key any, ok bool) {
	if node.Type != "paragraph" {
		return nil, false
	}
	var content []richTextNode
	for _, child := range node.Content {
		if child.Type == "text" && (child.Text == nil || strings.TrimSpace(*child.Text) == "") {
			continue
		}
		content = append(content, child)
	}
	if len(content) != 1 || content[0].Type != privacyBlockMention {
		return nil, false
	}
	return content[0].Attrs["id"], true
}

func isValidPrivacyDoc(raw json.RawMessage) bool {
	if isNull(raw) {
		return true
	}
	var compact bytes.Buffer
	if json.Compact(&compact, raw) != nil || utf8.RuneCount(compact.Bytes()) > maxPrivacyDoc || compact.Bytes()[0] != '{' {
		return false
	}
	var doc richTextNode
	if json.Unmarshal(raw, &doc) != nil || doc.Type != "doc" || doc.Content == nil {
		return false
	}
	seen := map[string]bool{}
	for _, node := range doc.Content {
		value, ok := privacyBlockKey(node)
		if !ok {
			continue
		}
		key, isString := value.(string)
		if !isString || !slices.Contains(privacyBlockKeys, key) || seen[key] {
			return false
		}
		seen[key] = true
	}
	for _, key := range requiredPrivacyBlocks {
		if !seen[key] {
			return false
		}
	}
	return true
}
