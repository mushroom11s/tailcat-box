package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/appinfo"
	"github.com/mushroom11s/tailcat-box/internal/settings"
	"github.com/mushroom11s/tailcat-box/internal/update"
)

const fixtureRelease = `{
  "tag_name": "v0.1.0",
  "draft": false,
  "prerelease": false,
  "html_url": "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.1.0",
  "body": "notes",
  "assets": [{
    "name": "tailcat-box-macos-arm64-v0.1.0.zip",
    "browser_download_url": "https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/tailcat-box-macos-arm64-v0.1.0.zip"
  }]
}`

func useLocalUpdateServer(t *testing.T) {
	t.Helper()
	_ = useCountingUpdateServer(t)
}

func useCountingUpdateServer(t *testing.T) *atomic.Int32 {
	t.Helper()
	hits := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("missing User-Agent")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fixtureRelease))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("TAILCAT_UPDATE_URL", srv.URL)
	return hits
}

func sampleUpdate(status, version string) settings.UpdateState {
	return settings.UpdateState{
		LatestTag:     "v" + version,
		LatestVersion: version,
		ReleaseURL:    "https://github.com/mushroom11s/tailcat-box/releases/tag/v" + version,
		Notes:         "notes",
		AssetName:     "tailcat-box-macos-arm64-v" + version + ".zip",
		DownloadURL:   "https://github.com/mushroom11s/tailcat-box/releases/download/v" + version + "/tailcat-box.zip",
		Status:        status,
	}
}

func TestComposeUpdateStatusHidesBadgeOnError(t *testing.T) {
	st := sampleUpdate("error", "0.9.0")
	st.Error = "network"
	got := composeUpdateStatus(st, "0.1.0-dev", "darwin")
	if got.UpdateAvailable {
		t.Fatal("error must not show NEW")
	}
	if got.LatestTag != "v0.9.0" {
		t.Fatalf("kept tag=%q", got.LatestTag)
	}
	unsupported := sampleUpdate("unsupported", "0.9.0")
	unsupported.Error = "no_asset"
	if composeUpdateStatus(unsupported, "0.1.0-dev", "linux").UpdateAvailable {
		t.Fatal("missing package must not show NEW")
	}
}

func TestComposeUpdateStatusDownloadFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/tailcat-box-macos-arm64-v0.2.0.zip"
	if err := os.WriteFile(path, []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	st := sampleUpdate("downloaded", "0.2.0")
	st.DownloadedPath = path
	got := composeUpdateStatus(st, "0.1.0-dev", "darwin")
	if !got.UpdateAvailable || got.Status != "downloaded" || got.DownloadedPath != path {
		t.Fatalf("%+v", got)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	missing := composeUpdateStatus(st, "0.1.0-dev", "darwin")
	if !missing.UpdateAvailable || missing.Status != "available" || missing.DownloadedPath != "" {
		t.Fatalf("missing file: %+v", missing)
	}
	current := composeUpdateStatus(st, "0.2.0", "darwin")
	if current.UpdateAvailable || current.Status != "upToDate" {
		t.Fatalf("caught up: %+v", current)
	}
}

func TestCheckForUpdatePersistsAndErrorClearsBadge(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	payload := []byte("zip-bytes")
	mode := "ok"
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("missing User-Agent")
		}
		if mode == "fail" {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		if r.URL.Path != "/" && r.URL.Path != "" {
			w.Header().Set("Content-Length", "9")
			_, _ = w.Write(payload)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"tag_name":"v0.2.0",
			"draft":false,
			"prerelease":false,
			"html_url":"https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
			"body":"Newer cat.",
			"assets":[{"name":"tailcat-box-macos-arm64-v0.2.0.zip","browser_download_url":"` + srv.URL + `/tailcat-box-macos-arm64-v0.2.0.zip","size":9}]
		}`))
	}))
	t.Cleanup(srv.Close)

	downloads := t.TempDir()
	a := NewApp()
	a.updates = update.New(update.Config{
		CurrentVersion:   appinfo.ClientVersion(),
		LatestURL:        srv.URL,
		HTTPClient:       srv.Client(),
		GOOS:             "darwin",
		GOARCH:           "arm64",
		DownloadsDir:     downloads,
		PermissiveAssets: true,
		UserAgent:        "TailcatBox/test (+https://github.com/mushroom11s/tailcat-box)",
	})

	status, err := a.CheckForUpdate()
	if err != nil {
		t.Fatal(err)
	}
	if !status.UpdateAvailable || status.LatestTag != "v0.2.0" || status.Status != update.StatusAvailable {
		t.Fatalf("%+v", status)
	}
	if status.Notes != "Newer cat." {
		t.Fatalf("notes=%q", status.Notes)
	}

	downloaded, err := a.DownloadUpdate()
	if err != nil {
		t.Fatal(err)
	}
	if downloaded.Status != update.StatusDownloaded || !downloaded.UpdateAvailable {
		t.Fatalf("%+v", downloaded)
	}
	body, err := os.ReadFile(downloaded.DownloadedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != string(payload) {
		t.Fatalf("zip=%q", body)
	}
	if a.GetUpdateStatus().DownloadedPath != downloaded.DownloadedPath {
		t.Fatal("download path not persisted")
	}

	mode = "fail"
	failed, err := a.CheckForUpdate()
	if err != nil {
		t.Fatal(err)
	}
	if failed.UpdateAvailable || failed.Status != update.StatusError || failed.Error != update.ErrNetwork {
		t.Fatalf("error status: %+v", failed)
	}
	if failed.LatestTag != "v0.2.0" {
		t.Fatalf("lost last tag: %+v", failed)
	}
}

func TestRevealDownloadedUpdateRequiresFile(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()
	if err := a.RevealDownloadedUpdate(); err == nil {
		t.Fatal("expected missing download to fail")
	}
}
