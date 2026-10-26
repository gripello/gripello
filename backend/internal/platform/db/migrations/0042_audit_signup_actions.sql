-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action IN ('create', 'update', 'delete', 'login', 'login_failed',
  'password_reset_request', 'password_reset', 'email_change_request', 'email_change',
  'register', 'register_existing', 'verification_request', 'email_verified')) NOT VALID;
-- +goose StatementEnd
ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_action_check;
