package update

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckReleaseFeed(t *testing.T) {
	t.Parallel()
	notes := strings.Repeat("甲", 40) + " tail"
	release := func(tag string, draft, pre bool, assets string) string {
		return fmt.Sprintf(`{
			"tag_name": %q,
			"draft": %t,
			"prerelease": %t,
			"html_url": "https://github.com/mushroom11s/tailcat-box/releases/tag/%s",
			"body": %q,
			"assets": [%s]
		}`, tag, draft, pre, tag, notes, assets)
	}
	asset := func(name string) string {
		return fmt.Sprintf(`{"name":%q,"browser_download_url":"https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/%s","size":4}`, name, name)
	}
	mac := asset("tailcat-box-macos-arm64-v0.1.0.zip")
	win := asset("tailcat-box-windows-amd64-v0.1.0.zip")

	cases := []struct {
		name    string
		status  int
		body    string
		headers map[string]string
		current string
		goos    string
		goarch  string
		wantSt  string
		wantErr string
		wantVer string
		wantURL string
	}{
		{
			name:    "dev build sees stable",
			status:  200,
			body:    release("v0.1.0", false, false, mac),
			current: "0.1.0-dev",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusAvailable, wantVer: "0.1.0",
			wantURL: "https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/tailcat-box-macos-arm64-v0.1.0.zip",
		},
		{
			name:    "same version",
			status:  200,
			body:    release("v0.1.0", false, false, mac),
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusUpToDate, wantVer: "0.1.0",
		},
		{
			name:    "newer than release",
			status:  200,
			body:    release("v0.1.0", false, false, mac),
			current: "0.2.0-dev",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusUpToDate, wantVer: "0.1.0",
		},
		{
			name:    "prerelease refused",
			status:  200,
			body:    release("v9.0.0", false, true, mac),
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrParse,
		},
		{
			name:    "draft refused",
			status:  200,
			body:    release("v9.0.0", true, false, mac),
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrParse,
		},
		{
			name:    "linux has no package",
			status:  200,
			body:    release("v0.1.0", false, false, mac+","+win),
			current: "0.0.1",
			goos:    "linux", goarch: "amd64",
			wantSt: StatusUnsupported, wantErr: ErrPlatform, wantVer: "0.1.0",
		},
		{
			name:    "missing asset",
			status:  200,
			body:    release("v0.2.0", false, false, win),
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusUnsupported, wantErr: ErrNoPackage, wantVer: "0.2.0",
		},
		{
			name:    "bad json",
			status:  200,
			body:    "{",
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrParse,
		},
		{
			name:    "server error",
			status:  500,
			body:    "nope",
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrNetwork,
		},
		{
			name:    "rate limit",
			status:  403,
			body:    `{"message":"API rate limit exceeded"}`,
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrRateLimit,
		},
		{
			name:    "invalid tag",
			status:  200,
			body:    release("latest", false, false, mac),
			current: "0.1.0",
			goos:    "darwin", goarch: "arm64",
			wantSt: StatusError, wantErr: ErrParse,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var sawUA string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sawUA = r.Header.Get("User-Agent")
				for k, v := range tc.headers {
					w.Header().Set(k, v)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c := New(Config{
				CurrentVersion: tc.current,
				LatestURL:      srv.URL,
				HTTPClient:     srv.Client(),
				GOOS:           tc.goos,
				GOARCH:         tc.goarch,
				UserAgent:      "TailcatBox/test (+https://github.com/mushroom11s/tailcat-box)",
			})
			got := c.Check(context.Background())
			if sawUA == "" {
				t.Fatal("missing User-Agent")
			}
			if got.Status != tc.wantSt || got.Error != tc.wantErr {
				t.Fatalf("status=%s error=%s want %s %s", got.Status, got.Error, tc.wantSt, tc.wantErr)
			}
			if tc.wantVer != "" && got.LatestVersion != tc.wantVer {
				t.Fatalf("version=%q want %q", got.LatestVersion, tc.wantVer)
			}
			if tc.wantURL != "" && got.DownloadURL != tc.wantURL {
				t.Fatalf("url=%q", got.DownloadURL)
			}
			if tc.wantSt == StatusError && got.Status == StatusAvailable {
				t.Fatal("error must not look available")
			}
			if got.Notes != "" && tc.wantSt != StatusError && !strings.HasSuffix(got.Notes, "tail") && len([]rune(notes)) <= notesRuneLimit {
				t.Fatalf("notes=%q", got.Notes)
			}
		})
	}
}

func TestExcerptTruncatesRunes(t *testing.T) {
	t.Parallel()
	body := strings.Repeat("猫", 8)
	got := Excerpt(body, 5)
	if got != "猫猫猫猫猫…" {
		t.Fatalf("excerpt=%q", got)
	}
	if Excerpt("  hello \r\n", 10) != "hello" {
		t.Fatalf("trim=%q", Excerpt("  hello \r\n", 10))
	}
}

func TestDownloadWritesZipAndProgress(t *testing.T) {
	t.Parallel()
	payload := []byte("PK zip-bytes")
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/latest" {
			fmt.Fprintf(w, `{
				"tag_name":"v0.2.0",
				"html_url":"https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
				"body":"Ship it",
				"assets":[{"name":"tailcat-box-macos-arm64-v0.2.0.zip","browser_download_url":"%s"}]
			}`, srv.URL+"/tailcat-box-macos-arm64-v0.2.0.zip")
			return
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
		_, _ = w.Write(payload)
	}))
	defer srv.Close()
	dir := t.TempDir()
	c := New(Config{
		CurrentVersion:   "0.1.0",
		LatestURL:        srv.URL + "/latest",
		HTTPClient:       srv.Client(),
		GOOS:             "darwin",
		GOARCH:           "arm64",
		DownloadsDir:     dir,
		PermissiveAssets: true,
		UserAgent:        UserAgent("0.1.0"),
	})
	got := c.Check(context.Background())
	if got.Status != StatusAvailable {
		t.Fatalf("status=%s err=%s", got.Status, got.Error)
	}
	var percents []int
	path, err := c.Download(context.Background(), got.DownloadURL, got.AssetName, func(p Progress) {
		percents = append(percents, p.Percent)
	})
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "tailcat-box-macos-arm64-v0.2.0.zip" {
		t.Fatalf("path=%s", path)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != string(payload) {
		t.Fatalf("body=%q", body)
	}
	if len(percents) == 0 || percents[len(percents)-1] != 100 {
		t.Fatalf("progress=%v", percents)
	}
	if _, err := os.Stat(path + ".partial"); !os.IsNotExist(err) {
		t.Fatal("partial file left behind")
	}
}

func TestDownloadRejectsForeignHost(t *testing.T) {
	t.Parallel()
	c := New(Config{
		CurrentVersion: "0.1.0",
		UserAgent:      UserAgent("0.1.0"),
		DownloadsDir:   t.TempDir(),
	})
	_, err := c.Download(context.Background(), "https://evil.example/tailcat-box.zip", "tailcat-box.zip", nil)
	if err == nil {
		t.Fatal("expected foreign host to fail")
	}
}
