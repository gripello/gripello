package db

import (
	"strconv"
	"strings"
)

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

// Where collects AND-ed conditions; each Add binds its arg to every ? of the clause.
type Where struct {
	Clauses []string
	Args    []any
}

func (w *Where) Add(clause string, arg any) {
	w.Clauses = append(w.Clauses, strings.ReplaceAll(clause, "?", w.Next(arg)))
}

func (w *Where) Next(arg any) string {
	w.Args = append(w.Args, arg)
	return "$" + strconv.Itoa(len(w.Args))
}

func (w *Where) SQL() string {
	if len(w.Clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.Clauses, " AND ")
}
