-- +goose Up
CREATE TABLE event_claims (
  event_id bigint NOT NULL REFERENCES events ON DELETE CASCADE,
  handler text NOT NULL,
  PRIMARY KEY (event_id, handler)
);

-- +goose Down
DROP TABLE event_claims;
