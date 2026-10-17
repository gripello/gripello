package main

import (
	"archive/tar"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/config"
)

func writeTar(t *testing.T, path string, files map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	tw := tar.NewWriter(f)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
}

func TestExtractBackupRestoresDumpAndStorage(t *testing.T) {
	dir := t.TempDir()
	archive, dump, blobs := filepath.Join(dir, "b.tar"), filepath.Join(dir, "database.dump"), filepath.Join(dir, "storage")
	writeTar(t, archive, map[string]string{"database.dump": "dump", "storage/gyms/g1/logo.png": "logo", "other.txt": "skip"})
	if err := extractBackup(archive, dump, blobs, true); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(blobs, "gyms", "g1", "logo.png")); string(got) != "logo" {
		t.Errorf("storage file = %q", got)
	}
	if got, _ := os.ReadFile(dump); string(got) != "dump" {
		t.Errorf("dump = %q", got)
	}
	if err := extractBackup(archive, dump, filepath.Join(dir, "untouched"), false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "untouched")); !os.IsNotExist(err) {
		t.Error("storage written without --storage")
	}
}

func TestExtractBackupRefusesEscapesAndArchivesWithoutADump(t *testing.T) {
	dir := t.TempDir()
	evil := filepath.Join(dir, "evil.tar")
	writeTar(t, evil, map[string]string{"database.dump": "dump", "storage/../../escaped.txt": "x"})
	if err := extractBackup(evil, filepath.Join(dir, "d"), filepath.Join(dir, "storage"), true); err == nil {
		t.Error("an entry escaping BLOB_DIR was accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "escaped.txt")); !os.IsNotExist(err) {
		t.Error("file written outside BLOB_DIR")
	}
	empty := filepath.Join(dir, "empty.tar")
	writeTar(t, empty, map[string]string{"storage/a.png": "x"})
	if err := extractBackup(empty, filepath.Join(dir, "d2"), filepath.Join(dir, "s2"), true); err == nil {
		t.Error("archive without database.dump accepted")
	}
}

// fakeRestoreTools puts a pg_restore that writes more SQL than a pipe buffers (then exits with restoreExit)
// and, unless withoutPsql, a psql that reads its input to EOF and only then marks the restore committed.
func fakeRestoreTools(t *testing.T, restoreExit int, withoutPsql bool) (archive, committed string) {
	t.Helper()
	dir := t.TempDir()
	archive, committed = filepath.Join(dir, "b.tar"), filepath.Join(dir, "committed")
	writeTar(t, archive, map[string]string{"database.dump": "dump"})
	tools := map[string]string{"pg_restore": fmt.Sprintf(`#!/bin/sh
i=0; while [ $i -lt 20000 ]; do echo 'select 1;'; i=$((i+1)); done
exit %d
`, restoreExit)}
	if !withoutPsql {
		tools["psql"] = "#!/bin/sh\nwhile read -r line; do :; done\n: > \"$RESTORE_COMMITTED\"\n"
	}
	for name, script := range tools {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
	t.Setenv("RESTORE_COMMITTED", committed)
	return archive, committed
}

func runAdminRestore(t *testing.T, archive string) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := adminRestore(ctx, config.Config{DatabaseURL: "postgres://gripello@127.0.0.1:1/gripello"}, []string{"--file", archive, "--yes"})
	if ctx.Err() != nil {
		t.Fatal("restore hung until the deadline")
	}
	return err
}

func TestAdminRestoreFailsWithoutPsqlInsteadOfHanging(t *testing.T) {
	archive, _ := fakeRestoreTools(t, 0, true)
	if err := runAdminRestore(t, archive); err == nil || !strings.Contains(err.Error(), "psql") {
		t.Fatalf("err = %v", err)
	}
}

func TestAdminRestoreStreamsTheDumpIntoPsql(t *testing.T) {
	archive, committed := fakeRestoreTools(t, 0, false)
	if err := runAdminRestore(t, archive); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(committed); err != nil {
		t.Error("psql did not read the whole dump")
	}
}

func TestAdminRestoreNeverCommitsAFailedPgRestore(t *testing.T) {
	archive, committed := fakeRestoreTools(t, 1, false)
	if err := runAdminRestore(t, archive); err == nil || !strings.Contains(err.Error(), "pg_restore") {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Stat(committed); !os.IsNotExist(err) {
		t.Error("psql committed a partial restore")
	}
}
