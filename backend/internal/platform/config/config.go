package config

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// DevDatabaseURL is the compose dev/test Postgres (docker-compose.dev.yml), the default only with GRIPELLO_ENV=dev.
var Version = "dev"

const DevDatabaseURL = "postgres://postgres:dev@localhost:5433/gripello?sslmode=disable"

type Config struct {
	HTTPAddr          string
	DatabaseURL       string
	AppURL            string
	BlobDir           string
	BackupDir         string
	LocalesDir        string
	TokenSecret       string
	AuthTokenDuration time.Duration
	UrgentAlertWindow time.Duration
	Role              string
	BlobDriver        string
	BlobAccelPrefix   string
	AppName           string
	SMTPHost          string
	SMTPPort          string
	SMTPUsername      string
	SMTPPassword      string
	SMTPTLS           bool
	SenderAddress     string
	SenderName        string
	VAPIDPublicKey    string
	VAPIDPrivateKey   string
}

func Load() (Config, error) {
	c := Config{
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		DatabaseURL:       env("DATABASE_URL", ""),
		AppURL:            env("APP_URL", "http://localhost:3000"),
		BlobDir:           env("BLOB_DIR", "./data/storage"),
		LocalesDir:        env("LOCALES_DIR", "../i18n/locales"),
		TokenSecret:       env("TOKEN_SECRET", ""),
		AuthTokenDuration: seconds("AUTH_TOKEN_SECONDS", 1209600),
		UrgentAlertWindow: seconds("URGENT_ALERT_SECONDS", 60),
		Role:              env("ROLE", "all"),
		BlobDriver:        env("BLOB_DRIVER", "fs"),
		BlobAccelPrefix:   env("BLOB_ACCEL_PREFIX", ""),
		AppName:           env("APP_NAME", "Gripello"),
		SMTPHost:          env("SMTP_HOST", ""),
		SMTPPort:          env("SMTP_PORT", "587"),
		SMTPUsername:      env("SMTP_USERNAME", ""),
		SMTPPassword:      env("SMTP_PASSWORD", ""),
		SMTPTLS:           env("SMTP_TLS", "true") != "false",
		SenderAddress:     env("SENDER_ADDRESS", ""),
		SenderName:        env("SENDER_NAME", "Gripello"),
		VAPIDPublicKey:    env("VAPID_PUBLIC_KEY", ""),
		VAPIDPrivateKey:   env("VAPID_PRIVATE_KEY", ""),
	}
	// Backups default to a folder beside the storage; BACKUP_DIR=off disables them.
	c.BackupDir = env("BACKUP_DIR", filepath.Join(filepath.Dir(c.BlobDir), "backups"))
	if c.BackupDir == "off" {
		c.BackupDir = ""
	}
	if c.BlobDriver != "fs" {
		return c, errors.New("BLOB_DRIVER: only fs is supported")
	}
	if c.DatabaseURL == "" && os.Getenv("GRIPELLO_ENV") != "dev" {
		return c, errors.New("DATABASE_URL is required (GRIPELLO_ENV=dev uses the local dev database)")
	}
	if c.DatabaseURL == "" {
		slog.Warn("DATABASE_URL not set, using the local dev database", "url", DevDatabaseURL)
		c.DatabaseURL = DevDatabaseURL
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func seconds(key string, fallback int) time.Duration {
	n, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		n = fallback
	}
	return time.Duration(n) * time.Second
}
