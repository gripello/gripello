-- +goose Up
CREATE INDEX events_topic_id_idx ON events (topic COLLATE "C", id);

-- +goose Down
DROP INDEX events_topic_id_idx;
