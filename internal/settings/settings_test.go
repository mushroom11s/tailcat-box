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

func TestUpdateStateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := settings.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	checked := time.Date(2026, 9, 23, 11, 4, 0, 0, time.UTC)
	err = s.SetUpdateState(settings.UpdateState{
		CheckedAt:      checked,
		LatestTag:      "v0.2.0",
		LatestVersion:  "0.2.0",
		ReleaseURL:     "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
		Notes:          "Pixel cats.",
		AssetName:      "tailcat-box-macos-arm64-v0.2.0.zip",
		DownloadURL:    "https://github.com/mushroom11s/tailcat-box/releases/download/v0.2.0/tailcat-box-macos-arm64-v0.2.0.zip",
		DownloadedPath: "/tmp/tailcat-box-macos-arm64-v0.2.0.zip",
		Status:         "downloaded",
	})
	if err != nil {
		t.Fatal(err)
	}
	later := checked.Add(time.Hour)
	if err := s.SetLastUpdateCheck(later); err != nil {
		t.Fatal(err)
	}
	reloaded, err := settings.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.UpdateState()
	if !got.CheckedAt.Equal(later) {
		t.Fatalf("checked=%s", got.CheckedAt)
	}
	if got.LatestTag != "v0.2.0" || got.Status != "downloaded" || got.Notes != "Pixel cats." {
		t.Fatalf("%+v", got)
	}
	if got.DownloadURL == "" || got.DownloadedPath == "" {
		t.Fatalf("%+v", got)
	}
}
