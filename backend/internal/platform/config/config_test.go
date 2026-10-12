package config

import "testing"

func TestDatabaseURLIsRequiredOutsideDev(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("GRIPELLO_ENV", "")
	if _, err := Load(); err == nil {
		t.Fatal("started without DATABASE_URL")
	}
	t.Setenv("GRIPELLO_ENV", "dev")
	if c, err := Load(); err != nil || c.DatabaseURL != DevDatabaseURL {
		t.Fatalf("dev mode: %q, %v", c.DatabaseURL, err)
	}
	t.Setenv("DATABASE_URL", "postgres://prod")
	t.Setenv("GRIPELLO_ENV", "")
	if c, err := Load(); err != nil || c.DatabaseURL != "postgres://prod" {
		t.Fatalf("explicit url: %q, %v", c.DatabaseURL, err)
	}
}

func TestBackupsDefaultBesideTheStorage(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://prod")
	t.Setenv("BLOB_DIR", "/srv/gripello/storage")
	for env, want := range map[string]string{"": "/srv/gripello/backups", "/mnt/backups": "/mnt/backups", "off": ""} {
		t.Setenv("BACKUP_DIR", env)
		if c, _ := Load(); c.BackupDir != want {
			t.Errorf("BACKUP_DIR=%q gives %q", env, c.BackupDir)
		}
	}
}

func TestOnlyTheCurrentEnvNamesAreRead(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://prod")
	t.Setenv("SMTP_HOST", "")
	t.Setenv("PB_SMTP_HOST", "smtp.old")
	t.Setenv("APP_URL", "")
	t.Setenv("PB_APP_URL", "https://old.example")
	c, _ := Load()
	if c.SMTPHost != "" || c.AppURL != "http://localhost:3000" {
		t.Fatalf("PB_ aliases still read: %q, %q", c.SMTPHost, c.AppURL)
	}
}
