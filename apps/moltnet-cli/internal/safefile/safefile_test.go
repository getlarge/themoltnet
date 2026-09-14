package safefile

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

func TestCreateWritesOnceAndRefusesAnExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")

	if err := Create(path, []byte("first")); err != nil {
		t.Fatalf("first create: %v", err)
	}
	err := Create(path, []byte("second"))

	if !errors.Is(err, ErrExists) {
		t.Fatalf("second create error = %v, want ErrExists", err)
	}
	got, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !bytes.Equal(got, []byte("first")) {
		t.Fatalf("existing file was overwritten: %q", got)
	}
	info, statErr := os.Stat(path)
	if statErr != nil {
		t.Fatal(statErr)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != PrivateMode {
		t.Fatalf("mode = %o, want %o", info.Mode().Perm(), PrivateMode)
	}
}

func TestCreateLetsExactlyOneConcurrentWriterWin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	const writers = 8
	results := make(chan error, writers)
	var start sync.WaitGroup
	start.Add(1)
	for i := 0; i < writers; i++ {
		go func(n int) {
			start.Wait()
			results <- Create(path, []byte{byte('a' + n)})
		}(i)
	}

	start.Done()
	created, refused := 0, 0
	for i := 0; i < writers; i++ {
		switch err := <-results; {
		case err == nil:
			created++
		case errors.Is(err, ErrExists):
			refused++
		default:
			t.Fatalf("unexpected create error: %v", err)
		}
	}

	if created != 1 || refused != writers-1 {
		t.Fatalf("created = %d, refused = %d; want exactly one winner", created, refused)
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

func TestAcquireRejectsGroupReadableLockOnPOSIX(t *testing.T) {
	// The permission assertion still has to bite where mode bits mean
	// something. Windows is exempt because Go reports 0666 for every file
	// there, which made this check reject every credential write on that
	// platform; the exemption must not quietly disable it everywhere else.
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "target")
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	lockPath := path + ".lock"
	if err := os.WriteFile(lockPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	lock, err := Acquire(path)
	if err == nil {
		_ = lock.Close()
		t.Fatal("expected a group-readable lock file to be rejected")
	}
	if !strings.Contains(err.Error(), "unsafe permissions") {
		t.Fatalf("error = %v, want it to mention unsafe permissions", err)
	}
}
