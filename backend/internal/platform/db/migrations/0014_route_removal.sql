-- +goose Up
ALTER TABLE routes ADD COLUMN removal_planned_for date;

DROP VIEW average_rating;
CREATE VIEW average_rating AS
SELECT routes.*,
  (SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::double precision AS average_rating,
  (SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::integer AS ratings_count
FROM routes;

-- +goose Down
DROP VIEW average_rating;
ALTER TABLE routes DROP COLUMN removal_planned_for;
CREATE VIEW average_rating AS
SELECT routes.*,
  (SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::double precision AS average_rating,
  (SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::integer AS ratings_count
FROM routes;
