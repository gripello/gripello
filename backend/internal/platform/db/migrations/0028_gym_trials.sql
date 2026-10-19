-- +goose Up
ALTER TABLE gyms ADD COLUMN trial_ends_at timestamptz;
ALTER TABLE gyms ADD COLUMN trial_notice smallint NOT NULL DEFAULT 0;
CREATE INDEX gyms_trial_ends_at_idx ON gyms (trial_ends_at) WHERE trial_ends_at IS NOT NULL;

CREATE TABLE gym_onboardings (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);

-- +goose StatementBegin
CREATE FUNCTION effective_permissions(gym_id text, permissions text[]) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM gyms g WHERE g.id = gym_id AND g.trial_ends_at < now())
    THEN ARRAY(SELECT p FROM unnest(permissions) p WHERE p = 'view_analytics')
    ELSE permissions END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION effective_permissions(text, text[]);
DROP TABLE gym_onboardings;
ALTER TABLE gyms DROP COLUMN trial_notice;
ALTER TABLE gyms DROP COLUMN trial_ends_at;
