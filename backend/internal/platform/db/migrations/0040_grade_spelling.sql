-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE tbl text; last text; upto text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['routes', 'ratings', 'ticks'] LOOP
    last := '';
    LOOP
      EXECUTE format('SELECT max(id) FROM (SELECT id FROM %I WHERE id > $1 ORDER BY id LIMIT 5000) b', tbl) INTO upto USING last;
      EXIT WHEN upto IS NULL;
      EXECUTE format($sql$UPDATE %I SET grade = CASE WHEN grade_system = 'french' THEN lower(grade) ELSE upper(grade) END
        WHERE id > $1 AND id <= $2
        AND ((grade_system IN ('font', 'v') AND grade <> upper(grade)) OR (grade_system = 'french' AND grade <> lower(grade)))$sql$, tbl)
        USING last, upto;
      last := upto;
      COMMIT;
    END LOOP;
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
SELECT 1;
