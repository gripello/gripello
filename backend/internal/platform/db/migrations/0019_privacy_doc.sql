-- +goose Up
ALTER TABLE gyms ADD COLUMN privacy_doc jsonb;
ALTER TABLE settings ADD COLUMN privacy_doc jsonb;

UPDATE gyms SET privacy_doc = jsonb_build_object('type', 'doc', 'content',
  jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', 'controller')))),
    jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2), 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', CASE language
        WHEN 'de' THEN 'Weitere Hinweise der Halle'
        WHEN 'nl' THEN 'Aanvullende informatie van de hal'
        WHEN 'fr' THEN 'Informations complémentaires de la salle'
        WHEN 'es' THEN 'Información adicional del rocódromo'
        ELSE 'Additional information from the gym'
      END)))
  ) || (
    SELECT jsonb_agg(jsonb_build_object('type', 'paragraph', 'content',
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim(line)))) ORDER BY position)
    FROM regexp_split_to_table(privacy_extra, E'\n') WITH ORDINALITY AS lines(line, position)
    WHERE btrim(line) <> ''
  ) || (
    SELECT jsonb_agg(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', key)))) ORDER BY position)
    FROM unnest(ARRAY[
      'scope', 'serverLogs', 'accounts', 'privacySettings', 'logbook', 'friends', 'profiles', 'leaderboards',
      'ratings', 'betaVideos', 'achievements', 'competitions', 'defects', 'reports', 'notifications', 'push',
      'dataExport', 'deletion', 'auditLog', 'captcha', 'map', 'thirdParties', 'storage', 'rights'
    ]) WITH ORDINALITY AS sections(key, position)
  ))
WHERE btrim(privacy_extra) <> '';

ALTER TABLE gyms DROP COLUMN privacy_extra;

-- +goose Down
ALTER TABLE gyms ADD COLUMN privacy_extra text NOT NULL DEFAULT '';
UPDATE gyms SET privacy_extra = COALESCE((
  SELECT string_agg(node #>> '{}', E'\n' ORDER BY position)
  FROM jsonb_array_elements(privacy_doc->'content') WITH ORDINALITY AS top(block, position),
    jsonb_path_query(block, 'strict $.**.text') AS node
  WHERE block->>'type' <> 'heading' AND NOT block @? '$.content[*] ? (@.type == "mention")'
), '')
WHERE privacy_doc IS NOT NULL;
ALTER TABLE settings DROP COLUMN privacy_doc;
ALTER TABLE gyms DROP COLUMN privacy_doc;
