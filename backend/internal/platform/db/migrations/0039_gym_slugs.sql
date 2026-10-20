-- +goose Up
CREATE TABLE gym_slugs (
  slug text PRIMARY KEY,
  gym text REFERENCES gyms(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('current', 'previous', 'retired')),
  CHECK ((kind = 'retired') = (gym IS NULL))
);
CREATE INDEX gym_slugs_gym_idx ON gym_slugs (gym);

INSERT INTO gym_slugs (slug, gym, kind)
SELECT slug, id, 'current' FROM gyms
UNION ALL SELECT DISTINCT p, id, 'previous' FROM gyms, jsonb_array_elements_text(previous_slugs) p WHERE p <> slug
UNION ALL SELECT slug, NULL, 'retired' FROM retired_slugs;

-- +goose StatementBegin
CREATE FUNCTION sync_gym_slugs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'gyms' THEN
    DELETE FROM gym_slugs WHERE gym = NEW.id;
    INSERT INTO gym_slugs (slug, gym, kind)
    SELECT NEW.slug, NEW.id, 'current'
    UNION ALL SELECT DISTINCT p, NEW.id, 'previous' FROM jsonb_array_elements_text(NEW.previous_slugs) p WHERE p <> NEW.slug;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO gym_slugs (slug, gym, kind) VALUES (NEW.slug, NULL, 'retired');
  ELSE
    DELETE FROM gym_slugs WHERE slug = OLD.slug AND kind = 'retired';
  END IF;
  RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE TRIGGER gyms_sync_slugs AFTER INSERT OR UPDATE OF slug, previous_slugs ON gyms FOR EACH ROW EXECUTE FUNCTION sync_gym_slugs();
CREATE TRIGGER retired_slugs_sync AFTER INSERT OR DELETE ON retired_slugs FOR EACH ROW EXECUTE FUNCTION sync_gym_slugs();

-- +goose Down
DROP TRIGGER retired_slugs_sync ON retired_slugs;
DROP TRIGGER gyms_sync_slugs ON gyms;
DROP FUNCTION sync_gym_slugs();
DROP TABLE gym_slugs;
