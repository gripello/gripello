-- +goose Up
CREATE TABLE user_last_seen (
  "user" text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  last_seen timestamptz NOT NULL
);
-- Sessions of users away longer than the token lifetime are gone; their own activity is the best trace left.
INSERT INTO user_last_seen ("user", last_seen)
  SELECT "user", max(seen) FROM (
    SELECT "user", greatest(last_seen, streamed_at) AS seen FROM sessions
    UNION ALL SELECT "user", max(created) FROM ticks GROUP BY "user"
    UNION ALL SELECT "user", max(created) FROM ratings WHERE "user" IS NOT NULL GROUP BY "user"
    UNION ALL SELECT "user", max(created) FROM beta_videos GROUP BY "user"
    UNION ALL SELECT follower, max(created) FROM follows GROUP BY follower
    UNION ALL SELECT "user", max(last_used) FROM mfa_factors GROUP BY "user"
    UNION ALL SELECT actor, max(created) FROM audit_logs WHERE actor IS NOT NULL GROUP BY actor
  ) activity WHERE seen IS NOT NULL AND seen <= now() GROUP BY "user";

-- +goose StatementBegin
CREATE FUNCTION stamp_user_last_seen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seen timestamptz := greatest(NEW.last_seen, NEW.streamed_at);
BEGIN
  -- The plain read takes no lock; the upsert locks even when its WHERE skips, and batched stream stamps would deadlock on it.
  IF seen IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_last_seen WHERE "user" = NEW."user" AND last_seen >= seen - interval '5 minutes') THEN
    INSERT INTO user_last_seen ("user", last_seen) VALUES (NEW."user", seen)
      ON CONFLICT ("user") DO UPDATE SET last_seen = excluded.last_seen
      WHERE user_last_seen.last_seen < excluded.last_seen - interval '5 minutes';
  END IF;
  RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE TRIGGER sessions_user_last_seen AFTER INSERT OR UPDATE OF last_seen, streamed_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION stamp_user_last_seen();

-- +goose Down
DROP TRIGGER sessions_user_last_seen ON sessions;
DROP FUNCTION stamp_user_last_seen();
DROP TABLE user_last_seen;
