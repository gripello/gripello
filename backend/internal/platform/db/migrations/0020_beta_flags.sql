-- +goose Up
UPDATE gyms SET features = (features - 'beta_videos')
  || jsonb_build_object('beta_links', features->'beta_videos', 'beta_uploads', features->'beta_videos')
WHERE features ? 'beta_videos';

-- +goose Down
UPDATE gyms SET features = (features - 'beta_links' - 'beta_uploads')
  || jsonb_build_object('beta_videos', COALESCE((features->>'beta_links')::boolean, false) OR COALESCE((features->>'beta_uploads')::boolean, false))
WHERE features ?| array['beta_links', 'beta_uploads'];
