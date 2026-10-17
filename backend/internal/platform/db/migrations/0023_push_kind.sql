-- +goose Up
ALTER TABLE push_subscriptions
    ADD COLUMN kind text NOT NULL DEFAULT 'webpush' CHECK (kind IN ('webpush', 'fcm')),
    ALTER COLUMN p256dh SET DEFAULT '',
    ALTER COLUMN auth SET DEFAULT '';

-- +goose Down
ALTER TABLE push_subscriptions
    DROP COLUMN kind,
    ALTER COLUMN p256dh DROP DEFAULT,
    ALTER COLUMN auth DROP DEFAULT;
