package safefile

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteUsesPrivateModeAndRejectsSymlinkTargets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Write(path, []byte("new")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != PrivateMode {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}

	target := filepath.Join(t.TempDir(), "target")
	link := filepath.Join(t.TempDir(), "link")
	if err := os.WriteFile(target, []byte("untouched"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := Write(link, []byte("secret")); err == nil {
		t.Fatal("write through symlink succeeded")
	}
	got, _ := os.ReadFile(target)
	if !bytes.Equal(got, []byte("untouched")) {
		t.Fatalf("symlink target changed: %q", got)
	}
}

func TestAcquireRejectsSymlinkLockWithoutMutatingTarget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte("credentials"), PrivateMode); err != nil {
		t.Fatal(err)
	}
	lockTarget := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(lockTarget, []byte("do-not-touch"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(lockTarget, path+".lock"); err != nil {
		t.Fatal(err)
	}
	if _, err := Acquire(path); err == nil {
		t.Fatal("symlinked lock was accepted")
	}
	got, _ := os.ReadFile(lockTarget)
	info, _ := os.Stat(lockTarget)
	if string(got) != "do-not-touch" || info.Mode().Perm() != 0o644 {
		t.Fatalf("lock target was mutated: content=%q mode=%o", got, info.Mode().Perm())
	}
}

func TestCooperatingWriterCannotInterleaveCompareAndReplace(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte("old"), PrivateMode); err != nil {
		t.Fatal(err)
	}
	lock, err := Acquire(path)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		done <- Write(path, []byte("second"))
	}()
	<-started
	select {
	case err := <-done:
		t.Fatalf("writer bypassed held lock: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	if err := lock.Replace([]byte("old"), []byte("first"), 32); err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "second" {
		t.Fatalf("final content = %q", got)
	}
}
