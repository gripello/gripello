package config

import (
	"errors"
	"log/slog"
	"os"
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
	LocalesDir        string
	TokenSecret       string
	AuthTokenDuration time.Duration
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

// Load reads env; PB_* names are accepted as aliases until the PocketBase deployment is gone.
func Load() (Config, error) {
	c := Config{
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		DatabaseURL:       env("DATABASE_URL", ""),
		AppURL:            env("APP_URL", env("PB_APP_URL", "http://localhost:3000")),
		BlobDir:           env("BLOB_DIR", "./data/storage"),
		LocalesDir:        env("LOCALES_DIR", env("PB_LOCALES_DIR", "../i18n/locales")),
		TokenSecret:       env("TOKEN_SECRET", ""),
		AuthTokenDuration: seconds("AUTH_TOKEN_SECONDS", 1209600),
		Role:              env("ROLE", "all"),
		BlobDriver:        env("BLOB_DRIVER", "fs"),
		BlobAccelPrefix:   env("BLOB_ACCEL_PREFIX", ""),
		AppName:           pbEnv("APP_NAME", "Gripello"),
		SMTPHost:          pbEnv("SMTP_HOST", ""),
		SMTPPort:          pbEnv("SMTP_PORT", "587"),
		SMTPUsername:      pbEnv("SMTP_USERNAME", ""),
		SMTPPassword:      pbEnv("SMTP_PASSWORD", ""),
		SMTPTLS:           pbEnv("SMTP_TLS", "true") != "false",
		SenderAddress:     pbEnv("SENDER_ADDRESS", ""),
		SenderName:        pbEnv("SENDER_NAME", "Gripello"),
		VAPIDPublicKey:    pbEnv("VAPID_PUBLIC_KEY", ""),
		VAPIDPrivateKey:   pbEnv("VAPID_PRIVATE_KEY", ""),
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

func pbEnv(key, fallback string) string {
	return env(key, env("PB_"+key, fallback))
}

func seconds(key string, fallback int) time.Duration {
	n, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		n = fallback
	}
	return time.Duration(n) * time.Second
}
