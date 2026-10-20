package realtime

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Keyed topic prefixes that are not gym ids. gymAudience topics carry gym content and must set Audience.Gym on every publish.
var (
	gymAudienceTopics = []string{"competition_changes:"}
	personalTopics    = []string{"user:"}
	notTopics         = []string{"deleted:", "unknown:", "email_source:", "id:"}
)

// TestEveryKeyedTopicIsGymGated walks the syntax tree of every module: a string literal "prefix:" + key is a keyed topic,
// and each one must either be keyed by gym (gymTopics, gated by visibility) or set Audience.Gym in the publishing function.
func TestEveryKeyedTopicIsGymGated(t *testing.T) {
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	found := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range file.Decls {
			if gen, ok := decl.(*ast.GenDecl); ok && gen.Tok == token.CONST {
				for _, prefix := range keyedPrefixes(gen) {
					found[prefix] = true
				}
			}
			ast.Inspect(decl, func(n ast.Node) bool {
				var body *ast.BlockStmt
				switch fn := n.(type) {
				case *ast.FuncDecl:
					body = fn.Body
				case *ast.FuncLit:
					body = fn.Body
				}
				if body == nil {
					return true
				}
				for _, prefix := range keyedPrefixes(body) {
					found[prefix] = true
					if !slices.Contains(gymAudienceTopics, prefix) {
						continue
					}
					for _, audience := range audienceLiterals(body) {
						if !hasKey(audience, "Gym") {
							t.Errorf("%s publishes %s without Audience.Gym", fset.Position(audience.Pos()), prefix)
						}
					}
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !found["gym_changes:"] || !found["competition_changes:"] || !found["leaderboard:"] {
		t.Fatalf("the walk found no topics: %v", found)
	}
	for prefix := range found {
		if !slices.Contains(gymTopics, prefix) && !slices.Contains(gymAudienceTopics, prefix) &&
			!slices.Contains(personalTopics, prefix) && !slices.Contains(notTopics, prefix) {
			t.Errorf("keyed topic %q is neither in gymTopics nor sets Audience.Gym; classify it here", prefix)
		}
	}
}

// keyedPrefixes finds "prefix:" + key expressions, and constants holding a prefix (Topic = "leaderboard:").
func keyedPrefixes(node ast.Node) []string {
	var out []string
	inspectShallow(node, func(n ast.Node) bool {
		if spec, ok := n.(*ast.ValueSpec); ok {
			for _, value := range spec.Values {
				if lit, ok := value.(*ast.BasicLit); ok && lit.Kind == token.STRING {
					if prefix, err := strconv.Unquote(lit.Value); err == nil && isTopicPrefix(prefix) {
						out = append(out, prefix)
					}
				}
			}
			return true
		}
		bin, ok := n.(*ast.BinaryExpr)
		if !ok || bin.Op != token.ADD {
			return true
		}
		lit, ok := bin.X.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(lit.Value)
		if err == nil && isTopicPrefix(value) {
			out = append(out, value)
		}
		return true
	})
	return out
}

func isTopicPrefix(s string) bool {
	if len(s) < 2 || !strings.HasSuffix(s, ":") {
		return false
	}
	for _, r := range s[:len(s)-1] {
		if (r < 'a' || r > 'z') && r != '_' {
			return false
		}
	}
	return true
}

func audienceLiterals(body *ast.BlockStmt) []*ast.CompositeLit {
	var out []*ast.CompositeLit
	inspectShallow(body, func(n ast.Node) bool {
		lit, ok := n.(*ast.CompositeLit)
		if !ok {
			return true
		}
		if sel, ok := lit.Type.(*ast.SelectorExpr); ok && sel.Sel.Name == "Audience" {
			out = append(out, lit)
		}
		return true
	})
	return out
}

func hasKey(lit *ast.CompositeLit, key string) bool {
	for _, elt := range lit.Elts {
		if kv, ok := elt.(*ast.KeyValueExpr); ok {
			if ident, ok := kv.Key.(*ast.Ident); ok && ident.Name == key {
				return true
			}
		}
	}
	return false
}

// inspectShallow skips nested function literals: each one is checked as its own publishing function.
func inspectShallow(node ast.Node, visit func(ast.Node) bool) {
	ast.Inspect(node, func(n ast.Node) bool {
		if _, ok := n.(*ast.FuncLit); ok && n != node {
			return false
		}
		return visit(n)
	})
}
