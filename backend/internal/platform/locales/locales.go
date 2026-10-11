package locales

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const Default = "en"

type Messages map[string]map[string]any

func Load(dir string) Messages {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	messages := Messages{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var locale map[string]any
		if json.Unmarshal(raw, &locale) != nil {
			continue
		}
		messages[strings.TrimSuffix(filepath.Base(file), ".json")] = locale
	}
	return messages
}

func (m Messages) Group(language, key string) map[string]any {
	var node any = m[language]
	for _, part := range strings.Split(key, ".") {
		branch, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		node = branch[part]
	}
	branch, _ := node.(map[string]any)
	return branch
}

func (m Messages) Lookup(language, key string) string {
	parent, last := "", key
	if index := strings.LastIndex(key, "."); index >= 0 {
		parent, last = key[:index], key[index+1:]
	}
	branch := m[language]
	if parent != "" {
		branch = m.Group(language, parent)
	}
	text, _ := branch[last].(string)
	return text
}

func (m Messages) Translate(language, key string, params map[string]any) string {
	text := m.Lookup(language, key)
	if text == "" {
		text = m.Lookup(Default, key)
	}
	for name, value := range params {
		text = strings.ReplaceAll(text, "{"+name+"}", fmt.Sprint(value))
	}
	return text
}

// Language returns the first candidate that has a locale file, else en.
func (m Messages) Language(candidates ...string) string {
	for _, candidate := range candidates {
		if _, ok := m[candidate]; ok && candidate != "" {
			return candidate
		}
	}
	return Default
}
