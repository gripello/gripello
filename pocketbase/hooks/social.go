package hooks

import (
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const (
	followedTicksTopic = "followed_ticks"
	followChangesTopic = "follow_changes"
	climberSearchLimit = 20
	climberLookupLimit = 200
)

type climber struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Banner string `json:"banner,omitempty"`
}

type climberProfile struct {
	climber
	Closed    bool `json:"closed"`
	Private   bool `json:"private"`
	Followers int  `json:"followers"`
	Following int  `json:"following"`
}

type friendTickChange struct {
	Action string `json:"action"`
	User   string `json:"user"`
	ID     string `json:"id"`
}

func registerSocial(app core.App) {
	app.OnRecordCreate("follows").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("follower") == e.Record.GetString("followee") {
			return apis.NewBadRequestError("You can't follow yourself.", nil)
		}
		if blockedEitherWay(e.App, e.Record.GetString("follower"), e.Record.GetString("followee")) {
			return apis.NewForbiddenError("This climber can't be followed.", nil)
		}
		followee, err := e.App.FindRecordById("users", e.Record.GetString("followee"))
		if err != nil {
			return apis.NewBadRequestError("Unknown climber.", nil)
		}
		switch followee.GetString("follow_policy") {
		case "closed":
			return apis.NewForbiddenError("This climber doesn't accept followers.", nil)
		case "open":
			e.Record.Set("status", "accepted")
		default:
			e.Record.Set("status", "pending")
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("blocks").BindFunc(func(e *core.RecordEvent) error {
		_, err := e.App.DB().NewQuery("DELETE FROM follows WHERE (follower = {:a} AND followee = {:b}) OR (follower = {:b} AND followee = {:a})").
			Bind(dbx.Params{"a": e.Record.GetString("blocker"), "b": e.Record.GetString("blocked")}).Execute()
		if err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("follows").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() && (e.Record.Original().GetString("status") != "pending" || e.Record.GetString("status") != "accepted") {
			return apis.NewBadRequestError("Only pending follow requests can be accepted.", nil)
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("follows").BindFunc(func(e *core.RecordEvent) error {
		follower, followee := followParties(e.App, e.Record)
		if follower != nil && followee != nil {
			kind, url := "follow_requested", "/friends?tab=requests"
			if e.Record.GetString("status") == "accepted" {
				kind, url = "new_follower", "/climber?id="+follower.Id
			}
			pushNotification(e.App, notification{Users: []*core.Record{followee}, Type: kind, Params: map[string]any{"name": fullName(follower)}, URL: url})
		}
		return e.Next()
	})

	app.OnRecordAfterUpdateSuccess("follows").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Original().GetString("status") == "pending" && e.Record.GetString("status") == "accepted" {
			if follower, followee := followParties(e.App, e.Record); follower != nil && followee != nil {
				pushNotification(e.App, notification{Users: []*core.Record{follower}, Type: "follow_accepted", Params: map[string]any{"name": fullName(followee)}, URL: "/climber?id=" + followee.Id})
			}
		}
		return e.Next()
	})

	onFollowChange := func(action string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			parties := []string{e.Record.GetString("follower"), e.Record.GetString("followee")}
			broadcast(e.App, followChangesTopic, map[string]string{"action": action, "id": e.Record.Id}, func(auth *core.Record) bool {
				return auth != nil && slices.Contains(parties, auth.Id)
			})
			return e.Next()
		}
	}
	app.OnRecordAfterCreateSuccess("follows").BindFunc(onFollowChange("create"))
	app.OnRecordAfterUpdateSuccess("follows").BindFunc(onFollowChange("update"))
	app.OnRecordAfterDeleteSuccess("follows").BindFunc(onFollowChange("delete"))

	onTickChange := func(action string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			broadcastFriendTick(e.App, action, e.Record)
			return e.Next()
		}
	}
	app.OnRecordCreateRequest("ratings").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			e.Record.Set("user", "")
			if e.Auth != nil {
				e.Record.Set("user", e.Auth.Id)
			}
		}
		return e.Next()
	})
	app.OnRecordUpdateRequest("ratings").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			e.Record.Set("user", e.Record.Original().GetString("user"))
		}
		return e.Next()
	})
	app.OnRecordEnrich("ratings").BindFunc(func(e *core.RecordEnrichEvent) error {
		enrichReviewAuthor(e)
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("ticks").BindFunc(onTickChange("create"))
	app.OnRecordAfterUpdateSuccess("ticks").BindFunc(onTickChange("update"))
	app.OnRecordAfterDeleteSuccess("ticks").BindFunc(onTickChange("delete"))

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/climbers", serveClimbers).Bind(apis.RequireAuth("users"), climberLookups.middleware())
		se.Router.GET("/api/climbers/{id}", serveClimberProfile).Bind(apis.RequireAuth("users"), climberLookups.middleware())
		return se.Next()
	})
}

func followParties(app core.App, follow *core.Record) (*core.Record, *core.Record) {
	follower, _ := app.FindRecordById("users", follow.GetString("follower"))
	followee, _ := app.FindRecordById("users", follow.GetString("followee"))
	return follower, followee
}

func acceptedFollowers(app core.App, userID string) []string {
	ids := []string{}
	err := app.DB().NewQuery("SELECT follower FROM follows WHERE followee = {:user} AND status = 'accepted'").
		Bind(dbx.Params{"user": userID}).Column(&ids)
	if err != nil {
		app.Logger().Error("social: failed to load followers", "user", userID, "error", err)
	}
	return ids
}

func enrichReviewAuthor(e *core.RecordEnrichEvent) {
	authorID := e.Record.GetString("user")
	if e.RequestInfo == nil || e.RequestInfo.Auth == nil || authorID == "" {
		return
	}
	e.Record.WithCustomData(true)
	e.Record.Set("mine", authorID == e.RequestInfo.Auth.Id)
	if author, ok := authorOf(e.App, authorID); ok && !author.anonymous {
		e.Record.Set("author", author.climber)
	}
}

func broadcastFriendTick(app core.App, action string, tick *core.Record) {
	userID := tick.GetString("user")
	if owner, err := app.FindRecordById("users", userID); err != nil || owner.GetBool("ticks_private") {
		return
	}
	followers := acceptedFollowers(app, userID)
	if len(followers) == 0 {
		return
	}
	broadcast(app, followedTicksTopic, friendTickChange{Action: action, User: userID, ID: tick.Id}, func(auth *core.Record) bool {
		return auth != nil && slices.Contains(followers, auth.Id)
	})
}

func connectedClimbers(app core.App, userID string) []string {
	ids := []string{}
	err := app.DB().NewQuery("SELECT followee FROM follows WHERE follower = {:user} AND status = 'accepted' UNION SELECT follower FROM follows WHERE followee = {:user}").
		Bind(dbx.Params{"user": userID}).Column(&ids)
	if err != nil {
		app.Logger().Error("social: failed to load connections", "user", userID, "error", err)
	}
	return ids
}

func climberOf(user *core.Record) climber {
	return climber{ID: user.Id, Name: fullName(user), Avatar: user.GetString("avatar"), Banner: user.GetString("banner")}
}

func visibleTo(viewer string, connected []string, user *core.Record) bool {
	return user.Id == viewer || user.GetString("follow_policy") != "closed" || slices.Contains(connected, user.Id)
}

func blockedEitherWay(app core.App, a, b string) bool {
	count, err := app.CountRecords("blocks", dbx.Or(
		dbx.HashExp{"blocker": a, "blocked": b},
		dbx.HashExp{"blocker": b, "blocked": a},
	))
	return err != nil || count > 0
}

func blockersOf(app core.App, userID string) []string {
	blockers := []string{}
	if err := app.DB().NewQuery("SELECT blocker FROM blocks WHERE blocked = {:user}").
		Bind(dbx.Params{"user": userID}).Column(&blockers); err != nil {
		app.Logger().Error("social: loading blockers failed", "user", userID, "error", err)
	}
	return blockers
}

func serveClimbers(e *core.RequestEvent) error {
	query := e.Request.URL.Query()
	connected := connectedClimbers(e.App, e.Auth.Id)
	var users []*core.Record
	var err error
	if term := strings.TrimSpace(query.Get("q")); term != "" {
		if len([]rune(term)) < 2 {
			return e.JSON(http.StatusOK, []climber{})
		}
		filter := []string{"id != {:me}", "follow_policy != 'closed'"}
		params := dbx.Params{"me": e.Auth.Id}
		for i, word := range strings.Fields(term)[:min(len(strings.Fields(term)), 3)] {
			key := "w" + strconv.Itoa(i)
			filter = append(filter, "(firstname ~ {:"+key+"} || name ~ {:"+key+"})")
			params[key] = word
		}
		users, err = e.App.FindRecordsByFilter("users", strings.Join(filter, " && "), "firstname,name", climberSearchLimit, 0, params)
	} else {
		ids := strings.Split(query.Get("ids"), ",")
		users, err = e.App.FindRecordsByIds("users", ids[:min(len(ids), climberLookupLimit)])
	}
	if err != nil {
		return e.BadRequestError("", err)
	}
	blockers := blockersOf(e.App, e.Auth.Id)
	result := []climber{}
	for _, user := range users {
		if visibleTo(e.Auth.Id, connected, user) && !slices.Contains(blockers, user.Id) {
			result = append(result, climberOf(user))
		}
	}
	return e.JSON(http.StatusOK, result)
}

func serveClimberProfile(e *core.RequestEvent) error {
	user, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil || !visibleTo(e.Auth.Id, connectedClimbers(e.App, e.Auth.Id), user) || slices.Contains(blockersOf(e.App, e.Auth.Id), user.Id) {
		return e.NotFoundError("", err)
	}
	profile := climberProfile{climber: climberOf(user), Closed: user.GetString("follow_policy") == "closed", Private: user.GetBool("ticks_private")}
	for field, target := range map[string]*int{"followee": &profile.Followers, "follower": &profile.Following} {
		count, err := e.App.CountRecords("follows", dbx.HashExp{field: user.Id, "status": "accepted"})
		if err != nil {
			return e.InternalServerError("", err)
		}
		*target = int(count)
	}
	return e.JSON(http.StatusOK, profile)
}
