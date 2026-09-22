package settings_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/settings"
)

func TestLoadMissingFileDefaults(t *testing.T) {
	s, err := settings.Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.LaunchAtLogin {
		t.Fatal("default LaunchAtLogin should be false")
	}
	if !s.LastUpdateCheck.IsZero() {
		t.Fatalf("default LastUpdateCheck should be zero, got %v", s.LastUpdateCheck)
	}
}

func TestPersistLaunchAtLoginAndLastUpdateCheck(t *testing.T) {
	dir := t.TempDir()
	s, err := settings.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	if err := s.SetLaunchAtLogin(true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLastUpdateCheck(now); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}

	reloaded, err := settings.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.LaunchAtLogin {
		t.Fatal("LaunchAtLogin not persisted")
	}
	if !reloaded.LastUpdateCheck.Equal(now) {
		t.Fatalf("LastUpdateCheck=%v want %v", reloaded.LastUpdateCheck, now)
	}
}
