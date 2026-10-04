package hooks

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

const defaultLanguage = "en"

type localeMessages map[string]map[string]any

var (
	appLocalesOnce sync.Once
	appLocales     localeMessages
)

func localesDir() string {
	return firstNonEmpty(os.Getenv("PB_LOCALES_DIR"), filepath.Join("..", "i18n", "locales"))
}

func loadedLocales(app core.App) localeMessages {
	appLocalesOnce.Do(func() {
		appLocales = loadLocales(localesDir())
		if len(appLocales) == 0 {
			app.Logger().Warn("i18n: no locale messages found", "dir", localesDir())
		}
	})
	return appLocales
}

func loadLocales(dir string) localeMessages {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	messages := localeMessages{}
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

func (messages localeMessages) group(language, key string) map[string]any {
	var node any = messages[language]
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

func (messages localeMessages) lookup(language, key string) string {
	parent, last := "", key
	if index := strings.LastIndex(key, "."); index >= 0 {
		parent, last = key[:index], key[index+1:]
	}
	branch := messages[language]
	if parent != "" {
		branch = messages.group(language, parent)
	}
	text, _ := branch[last].(string)
	return text
}

func (messages localeMessages) translate(language, key string, params map[string]any) string {
	text := messages.lookup(language, key)
	if text == "" {
		text = messages.lookup(defaultLanguage, key)
	}
	for name, value := range params {
		text = strings.ReplaceAll(text, "{"+name+"}", fmt.Sprint(value))
	}
	return text
}

func (messages localeMessages) language(candidates ...string) string {
	for _, candidate := range candidates {
		if _, ok := messages[candidate]; ok && candidate != "" {
			return candidate
		}
	}
	return defaultLanguage
}
