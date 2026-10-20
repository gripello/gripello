-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE last text := ''; upto text;
BEGIN
  LOOP
    SELECT max(id) INTO upto FROM (SELECT id FROM ticks WHERE id > last ORDER BY id LIMIT 5000) b;
    EXIT WHEN upto IS NULL;
    UPDATE ticks t SET grade = r.grade, grade_system = r.grade_system, grade_index = r.grade_index
      FROM routes r WHERE r.id = t.route AND t.id > last AND t.id <= upto
      AND (t.grade, t.grade_system, t.grade_index) IS DISTINCT FROM (r.grade, r.grade_system, r.grade_index);
    last := upto;
    COMMIT;
  END LOOP;
END $$;
-- +goose StatementEnd

DROP INDEX CONCURRENTLY IF EXISTS audit_logs_collection_idx;

-- +goose Down
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_collection_idx ON audit_logs (collection_name);
