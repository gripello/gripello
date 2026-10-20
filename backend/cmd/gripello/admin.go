package main

import (
	"archive/tar"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/gyms"
	"gripello/internal/members"
	"gripello/internal/platform/config"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
	platformmail "gripello/internal/platform/mail"
	pw "gripello/internal/platform/password"
)

const adminUsage = "usage: gripello admin create-user|set-user|delete-user|create-gym|add-membership|create-notification|truncate-prefix|restore [flags]"

func admin(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New(adminUsage)
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if args[0] == "restore" {
		return adminRestore(ctx, cfg, args[1:])
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	var id string
	switch args[0] {
	case "create-user":
		id, err = adminCreateUser(ctx, pool, args[1:])
	case "create-gym":
		id, err = adminCreateGym(ctx, pool, args[1:])
	case "add-membership":
		id, err = adminAddMembership(ctx, pool, args[1:])
	case "set-user":
		id, err = adminSetUser(ctx, pool, args[1:])
	case "delete-user":
		id, err = adminDeleteUser(ctx, pool, args[1:])
	case "create-notification":
		id, err = adminCreateNotification(ctx, pool, args[1:])
	case "truncate-prefix":
		id, err = adminTruncatePrefix(ctx, pool, args[1:])
	default:
		return errors.New(adminUsage)
	}
	if err == nil && id != "" {
		fmt.Println(id)
	}
	return err
}

func adminCreateUser(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("create-user", flag.ExitOnError)
	email := fs.String("email", "", "e-mail (existing accounts are updated)")
	password := fs.String("password", "", "password")
	username := fs.String("username", "", "username (default: the e-mail's local part)")
	firstname := fs.String("firstname", "", "first name")
	name := fs.String("name", "", "last name")
	verified := fs.Bool("verified", false, "mark the e-mail as verified")
	platformAdmin := fs.Bool("platform-admin", false, "grant platform admin")
	fs.Parse(args)
	*email = platformmail.NormalizeAddress(*email)
	if !platformmail.ValidAddress(*email) || pw.TooShort(*password) {
		return "", errors.New("create-user needs a valid --email and a --password of at least 8 characters")
	}
	if *username == "" {
		*username = ids.New()
	}
	hash, err := pw.Hash(*password)
	if err != nil {
		return "", err
	}
	var id string
	err = pool.QueryRow(ctx, `INSERT INTO users (id, email, email_visibility, verified, password_hash, token_key, username, firstname, name, platform_admin)
		VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (email) WHERE email <> '' DO UPDATE SET verified = EXCLUDED.verified, password_hash = EXCLUDED.password_hash,
			platform_admin = EXCLUDED.platform_admin, updated = now()
		RETURNING id`,
		ids.New(), *email, *verified, hash, rand.Text()+rand.Text(), *username, *firstname, *name, *platformAdmin).Scan(&id)
	return id, err
}

func adminCreateGym(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("create-gym", flag.ExitOnError)
	slug := fs.String("slug", "", "path slug")
	name := fs.String("name", "", "display name")
	inactive := fs.Bool("inactive", false, "create the gym inactive")
	hidden := fs.Bool("hidden", false, "only members and platform admins see the gym")
	features := fs.String("features", "{}", `feature flags merged into gyms.features, e.g. {"beta_links":true}`)
	fs.Parse(args)
	if *slug == "" || *name == "" {
		return "", errors.New("create-gym needs --slug and --name")
	}
	id, err := gyms.Create(ctx, pool, *slug, *name)
	if err != nil {
		return "", err
	}
	_, err = pool.Exec(ctx, `UPDATE gyms SET active = $2, hidden = $4, features = features || $3::jsonb, updated = now() WHERE id = $1`,
		id, !*inactive, *features, *hidden)
	return id, err
}

func adminAddMembership(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("add-membership", flag.ExitOnError)
	user := fs.String("user", "", "user id or e-mail")
	gym := fs.String("gym", "", "gym id or slug")
	role := fs.String("role", "", "role name in that gym; empty removes the membership")
	fs.Parse(args)
	if *user == "" || *gym == "" {
		return "", errors.New("add-membership needs --user and --gym")
	}
	var userID, gymID string
	if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 OR email = lower($1)`, *user).Scan(&userID); err != nil {
		return "", fmt.Errorf("user %q: %w", *user, err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM gyms WHERE id = $1 OR slug = $1`, *gym).Scan(&gymID); err != nil {
		return "", fmt.Errorf("gym %q: %w", *gym, err)
	}
	var roleID string
	if *role != "" {
		if err := pool.QueryRow(ctx, `SELECT id FROM roles WHERE gym = $1 AND (name = $2 OR id = $2)`, gymID, *role).Scan(&roleID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", fmt.Errorf("gym %q has no role %q", *gym, *role)
			}
			return "", err
		}
	}
	return members.SetMembership(ctx, pool, userID, gymID, roleID)
}

func findUserID(ctx context.Context, pool *pgxpool.Pool, user string) (string, error) {
	var id string
	if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 OR email = lower($1)`, user).Scan(&id); err != nil {
		return "", fmt.Errorf("user %q: %w", user, err)
	}
	return id, nil
}

func adminSetUser(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("set-user", flag.ExitOnError)
	user := fs.String("user", "", "user id or e-mail")
	verified := fs.Bool("verified", false, "e-mail verified")
	platformAdmin := fs.Bool("platform-admin", false, "platform admin")
	suspendedUntil := fs.String("suspended-until", "", "RFC 3339 time, empty lifts the suspension")
	password := fs.String("password", "", "new password")
	fs.Parse(args)
	if *user == "" {
		return "", errors.New("set-user needs --user")
	}
	id, err := findUserID(ctx, pool, *user)
	if err != nil {
		return "", err
	}
	set := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { set[f.Name] = true })
	if set["password"] && pw.TooShort(*password) {
		return "", errors.New("--password needs at least 8 characters")
	}
	hash, err := pw.Hash(*password)
	if err != nil {
		return "", err
	}
	var until *time.Time
	if *suspendedUntil != "" {
		parsed, err := time.Parse(time.RFC3339, *suspendedUntil)
		if err != nil {
			return "", err
		}
		until = &parsed
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET
				verified = CASE WHEN $2 THEN $3 ELSE verified END,
				platform_admin = CASE WHEN $4 THEN $5 ELSE platform_admin END,
				suspended_until = CASE WHEN $6 THEN $7 ELSE suspended_until END,
				password_hash = CASE WHEN $8 THEN $9 ELSE password_hash END,
				token_key = CASE WHEN $6 OR $8 THEN $10 ELSE token_key END,
				updated = now()
			WHERE id = $1`,
			id, set["verified"], *verified, set["platform-admin"], *platformAdmin,
			set["suspended-until"], until, set["password"], hash, rand.Text()+rand.Text()); err != nil {
			return err
		}
		// The running replicas cache verified tokens per user; any user:<id> event makes them check the new state.
		return events.Publish(ctx, tx, "user:"+id, "user.token_rotated", map[string]string{"user": id}, events.Audience{})
	})
	return id, err
}

func adminDeleteUser(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("delete-user", flag.ExitOnError)
	user := fs.String("user", "", "user id or e-mail")
	fs.Parse(args)
	if *user == "" {
		return "", errors.New("delete-user needs --user")
	}
	_, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1 OR email = lower($1)`, *user)
	return "", err
}

func adminCreateNotification(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("create-notification", flag.ExitOnError)
	user := fs.String("user", "", "user id or e-mail")
	kind := fs.String("type", "", "notification type")
	params := fs.String("params", "{}", "params as JSON")
	url := fs.String("url", "", "target url")
	fs.Parse(args)
	if *user == "" || *kind == "" {
		return "", errors.New("create-notification needs --user and --type")
	}
	userID, err := findUserID(ctx, pool, *user)
	if err != nil {
		return "", err
	}
	id := ids.New()
	_, err = pool.Exec(ctx, `INSERT INTO notifications (id, "user", type, params, url) VALUES ($1, $2, $3, $4::jsonb, $5)`, id, userID, *kind, *params, *url)
	return id, err
}

var truncatePrefixStatements = []string{
	`DELETE FROM notifications WHERE params::text LIKE $1 OR "user" IN (SELECT id FROM prefixed_users)`,
	`DELETE FROM moderation_items WHERE snapshot::text LIKE $1 OR snapshot::text LIKE $2 OR author IN (SELECT id FROM prefixed_users) OR content_id IN (SELECT id FROM prefixed_routes)`,
	`DELETE FROM reports WHERE explanation LIKE $1 OR notifier_name LIKE $1 OR notifier_email LIKE $1 OR content_id IN (SELECT id FROM prefixed_routes)`,
	`DELETE FROM tasks WHERE title LIKE $1 OR description LIKE $1 OR route IN (SELECT id FROM prefixed_routes) OR location IN (SELECT id FROM prefixed_locations)`,
	`DELETE FROM ticks WHERE route IN (SELECT id FROM prefixed_routes) OR "user" IN (SELECT id FROM prefixed_users)`,
	`DELETE FROM ratings WHERE comment LIKE $1 OR route_id IN (SELECT id FROM prefixed_routes)`,
	`DELETE FROM competitions WHERE name LIKE $1 OR location IN (SELECT id FROM prefixed_locations)`,
	`DELETE FROM seasons WHERE name LIKE $1`,
	`DELETE FROM routes WHERE id IN (SELECT id FROM prefixed_routes)`,
	`DELETE FROM walls WHERE name LIKE $1 OR location IN (SELECT id FROM prefixed_locations)`,
	`DELETE FROM locations WHERE id IN (SELECT id FROM prefixed_locations)`,
	`DELETE FROM invites WHERE email LIKE $1 OR role IN (SELECT id FROM roles WHERE name LIKE $1)`,
	`DELETE FROM memberships WHERE "user" IN (SELECT id FROM prefixed_users) OR role IN (SELECT id FROM roles WHERE name LIKE $1)`,
	`DELETE FROM users WHERE id IN (SELECT id FROM prefixed_users)`,
	`DELETE FROM roles WHERE name LIKE $1`,
}

func adminTruncatePrefix(ctx context.Context, pool *pgxpool.Pool, args []string) (string, error) {
	fs := flag.NewFlagSet("truncate-prefix", flag.ExitOnError)
	prefix := fs.String("prefix", "", "deletes test rows whose name, e-mail, username or text contains this, e.g. e2e-w3-")
	fs.Parse(args)
	if len(*prefix) < 6 {
		return "", errors.New("truncate-prefix needs a --prefix of at least 6 characters")
	}
	escape := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace
	pattern := "%" + escape(*prefix) + "%"
	dashless := "%" + escape(strings.ReplaceAll(*prefix, "-", "")) + "%"
	var deleted int64
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE prefixed_users ON COMMIT DROP AS
			SELECT id FROM users WHERE email LIKE $1 OR username LIKE $1 OR username LIKE $2`, pattern, dashless); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE prefixed_locations ON COMMIT DROP AS SELECT id FROM locations WHERE name LIKE $1`, pattern); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE prefixed_routes ON COMMIT DROP AS
			SELECT id FROM routes WHERE name LIKE $1 OR location IN (SELECT id FROM prefixed_locations)`, pattern); err != nil {
			return err
		}
		for _, statement := range truncatePrefixStatements {
			var params []any
			for i, value := range []string{pattern, dashless} {
				if strings.Contains(statement, fmt.Sprintf("$%d", i+1)) {
					params = append(params, value)
				}
			}
			tag, err := tx.Exec(ctx, statement, params...)
			if err != nil {
				return fmt.Errorf("%s: %w", statement, err)
			}
			deleted += tag.RowsAffected()
		}
		return nil
	})
	return fmt.Sprint(deleted), err
}

// adminRestore loads a backup archive: pg_restore into DATABASE_URL and, with --storage, the files into BLOB_DIR.
// Stop every other gripello container first; the restore replaces the whole database.
func adminRestore(ctx context.Context, cfg config.Config, args []string) error {
	fs := flag.NewFlagSet("restore", flag.ExitOnError)
	file := fs.String("file", "", "backup archive (gripello-YYYYMMDD-HHMMSS.tar)")
	storage := fs.Bool("storage", false, "also restore the files into BLOB_DIR")
	yes := fs.Bool("yes", false, "confirm that the database is replaced")
	fs.Parse(args)
	if *file == "" || !*yes {
		return errors.New("restore needs --file and --yes (it replaces the database; stop other gripello containers first)")
	}
	work, err := os.MkdirTemp("", "gripello-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	dump := filepath.Join(work, "database.dump")
	if err := extractBackup(*file, dump, "", false); err != nil {
		return err
	}
	env, err := db.CommandEnv(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	parsed, err := pgconn.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	// A fresh public schema (not pg_restore --clean): tables of migrations newer than the backup must go too,
	// or goose fails on them at the next start. psql runs the reset and the dump in one transaction.
	restore := exec.CommandContext(ctx, "pg_restore", "--no-owner", "--schema=public", "--file=-", dump)
	apply := exec.CommandContext(ctx, "psql", "-X", "-q", "--single-transaction", "-v", "ON_ERROR_STOP=1", "--dbname="+parsed.Database,
		"-c", "DROP SCHEMA public CASCADE", "-c", "CREATE SCHEMA public", "-f", "-")
	restore.Env, apply.Env = append(os.Environ(), env...), append(os.Environ(), env...)
	restore.Stderr, apply.Stdout, apply.Stderr = os.Stderr, os.Stdout, os.Stderr
	sql, sqlWriter, err := os.Pipe()
	if err != nil {
		return err
	}
	apply.Stdin, restore.Stdout = sql, sqlWriter
	if err := apply.Start(); err != nil {
		sql.Close()
		sqlWriter.Close()
		return fmt.Errorf("psql: %w (the database is unchanged)", err)
	}
	sql.Close()
	// Our write end stays open until pg_restore succeeded: on failure psql is killed before it reads EOF and commits.
	if err := restore.Run(); err != nil {
		apply.Process.Kill()
		sqlWriter.Close()
		apply.Wait()
		return fmt.Errorf("pg_restore: %w (the database is unchanged)", err)
	}
	sqlWriter.Close()
	if err := apply.Wait(); err != nil {
		return fmt.Errorf("psql: %w (the database is unchanged)", err)
	}
	if *storage {
		return extractBackup(*file, "", cfg.BlobDir, true)
	}
	return nil
}

// extractBackup writes database.dump to dump (unless dump is "") and storage/* below blobDir; os.Root keeps entries inside it.
func extractBackup(archive, dump, blobDir string, withStorage bool) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	var root *os.Root
	if withStorage {
		if err := os.MkdirAll(blobDir, 0o755); err != nil {
			return err
		}
		if root, err = os.OpenRoot(blobDir); err != nil {
			return err
		}
		defer root.Close()
	}
	found := false
	reader := tar.NewReader(f)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		var out io.WriteCloser
		switch rel, isStorage := strings.CutPrefix(header.Name, "storage/"); {
		case header.Name == "database.dump" && dump != "":
			found = true
			out, err = os.Create(dump)
		case isStorage && root != nil:
			if err = root.MkdirAll(path.Dir(rel), 0o755); err == nil {
				out, err = root.Create(rel)
			}
		default:
			continue
		}
		if err != nil {
			return err
		}
		_, err = io.Copy(out, reader)
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
	}
	if !found && dump != "" {
		return errors.New("restore: the archive has no database.dump")
	}
	return nil
}
