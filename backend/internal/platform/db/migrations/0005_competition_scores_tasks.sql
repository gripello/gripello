-- +goose Up
ALTER TABLE competition_scores ADD COLUMN scored_by text NOT NULL DEFAULT '';
ALTER TABLE ticks ADD COLUMN competition text REFERENCES competitions ON DELETE SET NULL;
CREATE INDEX ticks_competition_idx ON ticks (competition) WHERE competition IS NOT NULL;
ALTER TABLE tasks ADD COLUMN urgent_alerted_at timestamptz;
UPDATE tasks SET urgent_alerted_at = created WHERE kind = 'defect' AND priority = 4;

-- +goose Down
ALTER TABLE tasks DROP COLUMN urgent_alerted_at;
ALTER TABLE ticks DROP COLUMN competition;
ALTER TABLE competition_scores DROP COLUMN scored_by;
