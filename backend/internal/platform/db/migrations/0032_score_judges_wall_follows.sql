-- +goose Up
ALTER TABLE competition_scores ADD COLUMN by_judge boolean NOT NULL DEFAULT false;
UPDATE competition_scores s SET by_judge = true
  WHERE s.scored_by <> '' AND s.scored_by <> (SELECT e."user" FROM competition_entries e WHERE e.id = s.entry);
ALTER TABLE competition_scores ALTER COLUMN scored_by DROP NOT NULL, ALTER COLUMN scored_by DROP DEFAULT;
UPDATE competition_scores s SET scored_by = NULL
  WHERE s.scored_by = '' OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.scored_by);
ALTER TABLE competition_scores ADD CONSTRAINT competition_scores_scored_by_fkey FOREIGN KEY (scored_by) REFERENCES users ON DELETE SET NULL;
CREATE INDEX competition_scores_scored_by_idx ON competition_scores (scored_by) WHERE scored_by IS NOT NULL;

UPDATE users SET followed_walls = ARRAY(SELECT f FROM unnest(followed_walls) f WHERE EXISTS (SELECT 1 FROM walls w WHERE w.id = f))
  WHERE followed_walls <> '{}' AND NOT followed_walls <@ ARRAY(SELECT id FROM walls);

-- +goose Down
DROP INDEX competition_scores_scored_by_idx;
ALTER TABLE competition_scores DROP CONSTRAINT competition_scores_scored_by_fkey;
UPDATE competition_scores SET scored_by = '' WHERE scored_by IS NULL;
ALTER TABLE competition_scores ALTER COLUMN scored_by SET DEFAULT '', ALTER COLUMN scored_by SET NOT NULL;
ALTER TABLE competition_scores DROP COLUMN by_judge;
