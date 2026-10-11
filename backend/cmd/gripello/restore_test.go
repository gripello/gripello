package main

import (
	"archive/tar"
	"os"
	"path/filepath"
	"testing"
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
