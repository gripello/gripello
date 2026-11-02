package logbuf

import (
	"fmt"
	"go/ast"
	"go/parser"
	gotoken "go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

var slogLevels = map[string]bool{"Debug": true, "Info": true, "Warn": true, "Error": true}

// TestLogCallsFollowTheConventions keeps issues groupable and lines traceable: constant messages, errors under "error",
// and the Context variant wherever a request or context is at hand, so the line carries the request id.
func TestLogCallsFollowTheConventions(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	fset := gotoken.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, problem := range logCallProblems(fset, file) {
			t.Error(problem)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func logCallProblems(fset *gotoken.FileSet, file *ast.File) []string {
	var problems []string
	var contexts []string
	var walk func(n ast.Node) bool
	walk = func(n ast.Node) bool {
		var params *ast.FieldList
		var body *ast.BlockStmt
		switch fn := n.(type) {
		case *ast.FuncDecl:
			params, body = fn.Type.Params, fn.Body
		case *ast.FuncLit:
			params, body = fn.Type.Params, fn.Body
		case *ast.CallExpr:
			if problem := checkLogCall(fn, contexts); problem != "" {
				problems = append(problems, fmt.Sprintf("%s: %s", fset.Position(fn.Pos()), problem))
			}
			return true
		default:
			return true
		}
		if body == nil {
			return false
		}
		contexts = append(contexts, contextOf(params))
		ast.Inspect(body, walk)
		contexts = contexts[:len(contexts)-1]
		return false
	}
	ast.Inspect(file, walk)
	return problems
}

// contextOf names the expression giving the function's context: its context.Context or *http.Request parameter.
func contextOf(params *ast.FieldList) string {
	for _, field := range params.List {
		kind := ""
		switch typ := field.Type.(type) {
		case *ast.SelectorExpr:
			if pkg, ok := typ.X.(*ast.Ident); ok && pkg.Name == "context" && typ.Sel.Name == "Context" {
				kind = "ctx"
			}
		case *ast.StarExpr:
			if sel, ok := typ.X.(*ast.SelectorExpr); ok {
				if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "http" && sel.Sel.Name == "Request" {
					kind = "request"
				}
			}
		}
		for _, name := range field.Names {
			if kind == "" || name.Name == "_" {
				continue
			}
			if kind == "request" {
				return name.Name + ".Context()"
			}
			return name.Name
		}
	}
	return ""
}

func checkLogCall(call *ast.CallExpr, contexts []string) string {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	if pkg, ok := sel.X.(*ast.Ident); !ok || pkg.Name != "slog" {
		return ""
	}
	level, withContext := strings.CutSuffix(sel.Sel.Name, "Context")
	if !slogLevels[level] {
		return ""
	}
	args := call.Args
	if withContext {
		args = args[1:]
	}
	if len(args) == 0 {
		return "log call without a message"
	}
	if lit, ok := args[0].(*ast.BasicLit); !ok || lit.Kind != gotoken.STRING {
		return "the message must be a string literal (put variable parts into attributes), else every value becomes its own issue"
	}
	for i := 1; i < len(args); i += 2 {
		if lit, ok := args[i].(*ast.BasicLit); ok && lit.Kind == gotoken.STRING {
			if key, _ := strconv.Unquote(lit.Value); key == "err" {
				return `log errors under the key "error": only that key is masked for fingerprints`
			}
		}
	}
	if !withContext {
		for i := len(contexts) - 1; i >= 0; i-- {
			if contexts[i] != "" {
				return fmt.Sprintf("use slog.%sContext(%s, …) so the line carries the request id", level, contexts[i])
			}
		}
	}
	return ""
}
