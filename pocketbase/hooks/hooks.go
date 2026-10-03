package hooks

import "github.com/pocketbase/pocketbase/core"

func Register(app core.App) {
	registerAudit(app)
	registerGyms(app)
	registerBatchHeaderGuard(app)
	registerCaptcha(app)
	registerUserGuards(app)
	registerAdminRoleGuard(app)
	registerMemberships(app)
	registerLocationGuards(app)
	registerMapGuards(app)
	registerRouteArchiveStamp(app)
	registerRatingImport(app)
	registerTicks(app)
	registerReports(app)
	registerTasks(app)
	registerCompetitions(app)
	registerCompetitionTicks(app)
	registerLive(app)
	registerNotifications(app)
	registerSMTPFromEnv(app)
}
