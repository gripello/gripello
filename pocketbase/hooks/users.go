package hooks

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

func registerUserGuards(app core.App) {
	app.OnRecordDeleteExecute("users").Bind(&hook.Handler[*core.RecordEvent]{
		Priority: 100,
		Func: func(e *core.RecordEvent) error {
			if _, err := e.App.DB().NewQuery("UPDATE audit_logs SET actor = '' WHERE actor = {:id}").
				Bind(dbx.Params{"id": e.Record.Id}).Execute(); err != nil {
				return err
			}
			return e.Next()
		},
	})
}
