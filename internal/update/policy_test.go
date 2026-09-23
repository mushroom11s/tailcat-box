package update

import (
	"net/url"
	"testing"
)

func TestValidateAssetURL(t *testing.T) {
	t.Parallel()
	ok := "https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/tailcat-box-macos-arm64-v0.1.0.zip"
	if err := validateAssetURL(ok, false); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		"http://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/a.zip",
		"https://evil.example/a.zip",
		"https://github.com/other/tailcat-box/releases/download/v0.1.0/a.zip",
		"https://objects.githubusercontent.com/a.zip",
		"://bad",
	} {
		if err := validateAssetURL(raw, false); err == nil {
			t.Fatalf("validateAssetURL(%q) succeeded", raw)
		}
	}
	if err := validateAssetURL("http://127.0.0.1:9/a.zip", true); err != nil {
		t.Fatal(err)
	}
}

func TestAllowedRedirect(t *testing.T) {
	t.Parallel()
	allow := []string{
		"https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/a.zip",
		"https://release-assets.githubusercontent.com/github-production-release-asset/x",
		"https://objects.githubusercontent.com/github-production-release-asset-2e65be/x",
		"https://github-releases.githubusercontent.com/x",
	}
	for _, raw := range allow {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if !allowedRedirect(u, false) {
			t.Fatalf("blocked %s", raw)
		}
	}
	deny := []string{
		"https://evil.example/x.zip",
		"http://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/a.zip",
		"https://user:pass@github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/a.zip",
	}
	for _, raw := range deny {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if allowedRedirect(u, false) {
			t.Fatalf("allowed %s", raw)
		}
	}
	evil, err := url.Parse("https://evil.example/x.zip")
	if err != nil {
		t.Fatal(err)
	}
	if !allowedRedirect(evil, true) {
		t.Fatal("permissive mode should allow the test host")
	}
}
