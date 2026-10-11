package achievements

import (
	"context"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
)

func loadTicks(ctx context.Context, db *pgxpool.Pool, userID string) ([]achievementTick, error) {
	rows, err := db.Query(ctx, `
		SELECT COALESCE(t.route, ''), t.route_name, t.type, t.attempts, to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
			t.grade, t.grade_system, t.grade_index,
			COALESCE(r.gym, ''), COALESCE(r.wall, ''), COALESCE(r.color, ''),
			COALESCE(to_char(r.screw_date AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ''),
			COALESCE(to_char(r.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ''),
			COALESCE(r.permanent, false)
		FROM ticks t LEFT JOIN routes r ON r.id = t.route
		WHERE t."user" = $1
		ORDER BY t.date, t.created`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (achievementTick, error) {
		var t achievementTick
		err := row.Scan(&t.Route, &t.RouteName, &t.Type, &t.Attempts, &t.Date, &t.Grade, &t.GradeSystem, &t.GradeIndex,
			&t.Gym, &t.Wall, &t.Color, &t.ScrewDate, &t.ArchivedAt, &t.Permanent)
		return t, err
	})
}

var communityQueries = map[string]string{
	"first_ascents": `
		SELECT COUNT(DISTINCT t.route) FROM ticks t JOIN routes r ON r.id = t.route
		WHERE t."user" = $1 AND t.type <> 'attempt' AND NOT r.permanent
		AND NOT EXISTS (SELECT 1 FROM ticks o WHERE o.route = t.route AND o.type <> 'attempt' AND (o.date, o.created) < (t.date, t.created))`,
	"wall_clears": `
		SELECT COUNT(*) FROM walls w
		WHERE w.id IN (SELECT r.wall FROM ticks t JOIN routes r ON r.id = t.route WHERE t."user" = $1 AND t.type <> 'attempt')
		AND (SELECT COUNT(*) FROM routes r WHERE r.wall = w.id AND NOT r.archived) >= ` + strconv.Itoa(wallClearMinimum) + `
		AND NOT EXISTS (
			SELECT 1 FROM routes r WHERE r.wall = w.id AND NOT r.archived
			AND NOT EXISTS (SELECT 1 FROM ticks t WHERE t.route = r.id AND t."user" = $1 AND t.type <> 'attempt'))`,
	"reviews": `SELECT COUNT(*) FROM ratings WHERE "user" = $1`,
	"betas":   `SELECT COUNT(*) FROM beta_videos WHERE "user" = $1`,
	"friends": `SELECT COUNT(DISTINCT CASE WHEN follower = $1 THEN followee ELSE follower END) FROM follows
		WHERE status = 'accepted' AND (follower = $1 OR followee = $1)`,
	"helper":       `SELECT COUNT(*) FROM tasks WHERE kind = 'defect' AND reporter = $1 AND status = 'done'`,
	"competitions": `SELECT COUNT(DISTINCT competition) FROM competition_entries WHERE "user" = $1 AND status IN ('registered', 'checked_in')`,
	"season_top10": `SELECT COUNT(DISTINCT season) FROM (` + seasonTopTenSQL(`s.window_to <= now()
		AND s.gym IN (SELECT r.gym FROM ticks t JOIN routes r ON r.id = t.route WHERE t."user" = $1)`) + `) placed WHERE "user" = $1`,
}

func communityMetrics(ctx context.Context, db *pgxpool.Pool, userID string) (map[string]metric, error) {
	metrics := map[string]metric{}
	for key, query := range communityQueries {
		var count int
		if err := db.QueryRow(ctx, query, userID).Scan(&count); err != nil {
			return nil, err
		}
		metrics[key] = metric{Value: count}
	}
	return metrics, nil
}

// seasonTopTenSQL yields (season, user) for every climber ranked ≤ 10 on a season's boulder or route board, as the leaderboard
// ranks them: best 10 distinct sends, grade_index × 100 + 33 per flash, ties share a rank. seasonFilter sees s.gym, s.window_to.
// ponytail: recomputed per call, unlike the cached boards in ticks; cache when profiles with many finished seasons get slow.
func seasonTopTenSQL(seasonFilter string) string {
	return `
		WITH s AS (
			SELECT id, gym, window_from, window_to FROM (
				SELECT id, gym, date_trunc('day', starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS window_from,
					(date_trunc('day', ends_at AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC' AS window_to
				FROM seasons) s
			WHERE ` + seasonFilter + `
		), sends AS (
			SELECT s.id AS season, t.grade_system IN ('font', 'v') AS boulder, t."user",
				round((MAX(t.grade_index) * 100)::numeric)::int + CASE WHEN bool_or(t.type = 'flash') THEN 33 ELSE 0 END AS points
			FROM s JOIN routes r ON r.gym = s.gym JOIN ticks t ON t.route = r.id JOIN users u ON u.id = t."user"
			WHERE t.type <> 'attempt' AND t.grade_index > 0 AND t.date >= s.window_from AND t.date < s.window_to AND NOT u.leaderboard_hidden
			GROUP BY s.id, boulder, t."user", t.route
		), best AS (
			SELECT season, boulder, "user", points, row_number() OVER (PARTITION BY season, boulder, "user" ORDER BY points DESC) AS n FROM sends
		), scores AS (
			SELECT season, boulder, "user", SUM(points) FILTER (WHERE n <= 10) AS score FROM best GROUP BY season, boulder, "user"
		)
		SELECT season, "user" FROM (
			SELECT season, "user", rank() OVER (PARTITION BY season, boulder ORDER BY score DESC) AS place FROM scores
		) ranked WHERE place <= 10`
}

// finishedSeasonTopTens returns the top-ten climbers of seasons that ended within the last 48 hours.
func finishedSeasonTopTens(ctx context.Context, db *pgxpool.Pool, now time.Time) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT "user" FROM (`+seasonTopTenSQL(`s.window_to <= $1 AND s.window_to >= $1 - interval '48 hours'`)+`) placed`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func computeAchievements(ctx context.Context, db *pgxpool.Pool, userID string, now time.Time) (map[string]metric, error) {
	ticks, err := loadTicks(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	metrics := tickMetrics(ticks, now)
	community, err := communityMetrics(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	for key, value := range community {
		metrics[key] = value
	}
	return metrics, nil
}

type badge struct {
	Key    string
	Tier   int
	Earned string
}

func storedBadges(ctx context.Context, db *pgxpool.Pool, userID string) ([]badge, error) {
	rows, err := db.Query(ctx, `SELECT key, tier, COALESCE(to_char(earned_on AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '') FROM user_badges WHERE "user" = $1`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (badge, error) {
		var b badge
		err := row.Scan(&b.Key, &b.Tier, &b.Earned)
		return b, err
	})
}

type Notify struct {
	Type   string         `json:"type"`
	Users  []string       `json:"users"`
	Gym    string         `json:"gym"`
	Params map[string]any `json:"params"`
	URL    string         `json:"url"`
}

// award stores newly reached tiers and notifies. The first evaluation is silent when it backfills tiers reached before today.
func award(ctx context.Context, db *pgxpool.Pool, userID string, now time.Time) ([]badge, error) {
	metrics, err := computeAchievements(ctx, db, userID, now)
	if err != nil {
		return nil, err
	}
	stored, err := storedBadges(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, b := range stored {
		have[b.Key+"#"+strconv.Itoa(b.Tier)] = true
	}
	today := now.UTC().Format(time.DateOnly)
	var earned []badge
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		for _, definition := range achievements {
			current := metrics[definition.Key]
			for tier := 1; tier <= tierFor(definition, current.Value); tier++ {
				if have[definition.Key+"#"+strconv.Itoa(tier)] {
					continue
				}
				earnedOn := today
				if threshold := definition.Tiers[tier-1]; threshold <= len(current.Days) {
					earnedOn = current.Days[threshold-1]
				}
				tag, err := tx.Exec(ctx, `INSERT INTO user_badges (id, "user", key, tier, earned_on) VALUES ($1, $2, $3, $4, ($5::text::date + time '12:00') AT TIME ZONE 'UTC')
					ON CONFLICT ("user", key, tier) DO NOTHING`, ids.New(), userID, definition.Key, tier, earnedOn)
				if err != nil {
					return err
				}
				if tag.RowsAffected() > 0 {
					earned = append(earned, badge{Key: definition.Key, Tier: tier, Earned: earnedOn})
				}
			}
		}
		if len(stored) == 0 && slices.ContainsFunc(earned, func(b badge) bool { return b.Earned < today }) {
			earned = nil
		}
		if len(earned) == 0 {
			return nil
		}
		return events.Publish(ctx, tx, "notify", "notify", Notify{
			Type:   "achievement_earned",
			Users:  []string{userID},
			Params: map[string]any{"count": len(earned), "key": earned[len(earned)-1].Key},
			URL:    "/climber?id=" + userID + "#achievements",
		}, events.Audience{})
	})
	return earned, err
}

// profileVisible: sends not private, the viewer follows (accepted) or is followed by the climber, viewer not blocked.
func profileVisible(ctx context.Context, db *pgxpool.Pool, viewer, userID string) (exists, visible bool, err error) {
	err = db.QueryRow(ctx, `
		SELECT true, NOT u.ticks_private
			AND (EXISTS (SELECT 1 FROM follows WHERE follower = $1 AND followee = u.id AND status = 'accepted')
				OR EXISTS (SELECT 1 FROM follows WHERE follower = u.id AND followee = $1))
			AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocker = u.id AND blocked = $1)
		FROM users u WHERE u.id = $2`, viewer, userID).Scan(&exists, &visible)
	if err == pgx.ErrNoRows {
		return false, false, nil
	}
	return exists, visible, err
}
