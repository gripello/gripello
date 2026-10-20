-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE duplicates text;
BEGIN
  SELECT string_agg(ids, '; ') INTO duplicates FROM (
    SELECT string_agg(id, ', ' ORDER BY created) AS ids FROM users WHERE email <> '' GROUP BY lower(email) HAVING count(*) > 1) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'users whose e-mails differ only in case (change or merge them, then restart): %', duplicates;
  END IF;
END $$;
-- +goose StatementEnd

UPDATE users SET email = lower(email) WHERE email <> lower(email);
DELETE FROM invites i WHERE EXISTS (SELECT 1 FROM invites o WHERE o.gym = i.gym AND lower(o.email) = lower(i.email) AND o.email <> i.email
  AND (o.created, o.id) > (i.created, i.id));
UPDATE invites SET email = lower(email) WHERE email <> lower(email);
DELETE FROM gym_onboardings g WHERE EXISTS (SELECT 1 FROM gym_onboardings o WHERE lower(o.email) = lower(g.email) AND o.email <> g.email
  AND (o.created, o.id) > (g.created, g.id));
UPDATE gym_onboardings SET email = lower(email) WHERE email <> lower(email);
UPDATE reports SET notifier_email = lower(notifier_email) WHERE notifier_email <> lower(notifier_email);

DROP INDEX IF EXISTS users_lower_email_unique_idx;
DROP INDEX IF EXISTS users_lower_email_idx;

ALTER TABLE users ADD CONSTRAINT users_email_check CHECK (email = lower(email) AND char_length(email) <= 254);
ALTER TABLE invites ADD CONSTRAINT invites_email_check CHECK (email = lower(email) AND char_length(email) <= 254);
ALTER TABLE gym_onboardings ADD CONSTRAINT gym_onboardings_email_check CHECK (email = lower(email) AND char_length(email) <= 254);
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_check CHECK (char_length(endpoint) <= 2048);

-- +goose Down
ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_check;
ALTER TABLE gym_onboardings DROP CONSTRAINT gym_onboardings_email_check;
ALTER TABLE invites DROP CONSTRAINT invites_email_check;
ALTER TABLE users DROP CONSTRAINT users_email_check;
CREATE INDEX users_lower_email_idx ON users (lower(email));
