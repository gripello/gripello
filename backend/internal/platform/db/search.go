package db

import "strings"

const maxSearchWords = 8

var likeEscaper = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`)

// Match with NOT EXISTS (SELECT 1 FROM unnest($n::text[]) w WHERE NOT (col ILIKE w OR …)).
func WordPatterns(term string) []string {
	patterns := []string{}
	words := strings.Fields(term)
	for _, word := range words[:min(len(words), maxSearchWords)] {
		patterns = append(patterns, "%"+likeEscaper.Replace(word)+"%")
	}
	return patterns
}
