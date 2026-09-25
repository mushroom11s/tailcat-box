package update

import (
	"errors"
	"testing"
)

func assetsFor(names ...string) []Asset {
	out := make([]Asset, 0, len(names))
	for _, name := range names {
		out = append(out, Asset{
			Name: name,
			URL:  "https://github.com/mushroom11s/tailcat-box/releases/download/v0.1.0/" + name,
		})
	}
	return out
}

func TestSelectAsset(t *testing.T) {
	t.Parallel()
	published := assetsFor(
		"tailcat-box-macos-arm64-v0.1.0.zip",
		"tailcat-box-macos-amd64-v0.1.0.zip",
		"tailcat-box-windows-amd64-v0.1.0.zip",
		"tailcat-box-windows-arm64-v0.1.0.zip",
		"SHA256SUMS",
	)
	cases := []struct {
		name    string
		assets  []Asset
		goos    string
		goarch  string
		tag     string
		want    string
		wantErr error
	}{
		{name: "darwin arm64", assets: published, goos: "darwin", goarch: "arm64", tag: "v0.1.0", want: "tailcat-box-macos-arm64-v0.1.0.zip"},
		{name: "darwin amd64", assets: published, goos: "darwin", goarch: "amd64", tag: "v0.1.0", want: "tailcat-box-macos-amd64-v0.1.0.zip"},
		{name: "windows amd64", assets: published, goos: "windows", goarch: "amd64", tag: "v0.1.0", want: "tailcat-box-windows-amd64-v0.1.0.zip"},
		{name: "windows arm64", assets: published, goos: "windows", goarch: "arm64", tag: "v0.1.0", want: "tailcat-box-windows-arm64-v0.1.0.zip"},
		{
			name:   "case folded",
			assets: assetsFor("Tailcat-Box-MacOS-arm64-v0.1.0.zip"),
			goos:   "darwin", goarch: "arm64", tag: "v0.1.0",
			want: "Tailcat-Box-MacOS-arm64-v0.1.0.zip",
		},
		{
			name:   "tag without v still matches v filename",
			assets: published,
			goos:   "darwin", goarch: "arm64", tag: "0.1.0",
			want: "tailcat-box-macos-arm64-v0.1.0.zip",
		},
		{
			name:   "bare filename",
			assets: assetsFor("tailcat-box-macos-arm64-0.1.0.zip"),
			goos:   "darwin", goarch: "arm64", tag: "v0.1.0",
			want: "tailcat-box-macos-arm64-0.1.0.zip",
		},
		{
			name:   "single prefix fallback",
			assets: assetsFor("tailcat-box-macos-arm64-extra.zip"),
			goos:   "darwin", goarch: "arm64", tag: "v0.1.0",
			want: "tailcat-box-macos-arm64-extra.zip",
		},
		{name: "linux", assets: published, goos: "linux", goarch: "amd64", tag: "v0.1.0", wantErr: ErrUnsupportedPlatform},
		{name: "386", assets: published, goos: "windows", goarch: "386", tag: "v0.1.0", wantErr: ErrUnsupportedPlatform},
		{
			name: "prefers dmg over zip",
			assets: assetsFor(
				"tailcat-box-macos-arm64-v0.4.0.zip",
				"tailcat-box-macos-arm64-v0.4.0.dmg",
			),
			goos: "darwin", goarch: "arm64", tag: "v0.4.0",
			want: "tailcat-box-macos-arm64-v0.4.0.dmg",
		},
		{
			name: "prefers exe over zip",
			assets: assetsFor(
				"tailcat-box-windows-amd64-v0.4.0.zip",
				"tailcat-box-windows-amd64-v0.4.0.exe",
			),
			goos: "windows", goarch: "amd64", tag: "v0.4.0",
			want: "tailcat-box-windows-amd64-v0.4.0.exe",
		},
		{
			name: "prefers labeled installer over portable zip",
			assets: assetsFor(
				"tailcat-box-windows-amd64-v1.1.1.zip",
				"tailcat-box-windows-amd64-installer-v1.1.1.exe",
			),
			goos: "windows", goarch: "amd64", tag: "v1.1.1",
			want: "tailcat-box-windows-amd64-installer-v1.1.1.exe",
		},
		{
			name: "prefers labeled installer over portable bare exe",
			assets: assetsFor(
				"tailcat-box-windows-amd64-v1.1.2.exe",
				"tailcat-box-windows-amd64-installer-v1.1.2.exe",
			),
			goos: "windows", goarch: "amd64", tag: "v1.1.2",
			want: "tailcat-box-windows-amd64-installer-v1.1.2.exe",
		},
		{
			name: "arm64 prefers labeled installer over portable bare exe",
			assets: assetsFor(
				"tailcat-box-windows-arm64-installer-v1.1.2.exe",
				"tailcat-box-windows-arm64-v1.1.2.exe",
			),
			goos: "windows", goarch: "arm64", tag: "v1.1.2",
			want: "tailcat-box-windows-arm64-installer-v1.1.2.exe",
		},
		{
			name: "arm64 labeled installer",
			assets: assetsFor(
				"tailcat-box-windows-arm64-v1.1.1.zip",
				"tailcat-box-windows-arm64-installer-v1.1.1.exe",
			),
			goos: "windows", goarch: "arm64", tag: "v1.1.1",
			want: "tailcat-box-windows-arm64-installer-v1.1.1.exe",
		},
		{
			name:   "labeled installer only",
			assets: assetsFor("tailcat-box-windows-amd64-installer-v1.1.1.exe"),
			goos:   "windows", goarch: "amd64", tag: "v1.1.1",
			want: "tailcat-box-windows-amd64-installer-v1.1.1.exe",
		},
		{
			name: "labeled installer beats legacy exe and portable zip",
			assets: assetsFor(
				"tailcat-box-windows-amd64-v1.1.1.zip",
				"tailcat-box-windows-amd64-v1.1.1.exe",
				"tailcat-box-windows-amd64-installer-v1.1.1.exe",
			),
			goos: "windows", goarch: "amd64", tag: "v1.1.1",
			want: "tailcat-box-windows-amd64-installer-v1.1.1.exe",
		},
		{
			name:   "dmg only",
			assets: assetsFor("tailcat-box-macos-amd64-v0.4.0.dmg"),
			goos:   "darwin", goarch: "amd64", tag: "v0.4.0",
			want: "tailcat-box-macos-amd64-v0.4.0.dmg",
		},
		{name: "missing", assets: assetsFor("tailcat-box-windows-amd64-v0.1.0.zip"), goos: "darwin", goarch: "arm64", tag: "v0.1.0", wantErr: ErrNoAsset},
		{
			name: "ambiguous",
			assets: assetsFor(
				"tailcat-box-macos-arm64-v0.1.0-a.zip",
				"tailcat-box-macos-arm64-v0.1.0-b.zip",
			),
			goos: "darwin", goarch: "arm64", tag: "v9.9.9",
			wantErr: ErrNoAsset,
		},
		{
			name: "empty url skipped",
			assets: []Asset{{
				Name: "tailcat-box-macos-arm64-v0.1.0.zip",
			}},
			goos: "darwin", goarch: "arm64", tag: "v0.1.0",
			wantErr: ErrNoAsset,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := SelectAsset(tc.assets, tc.goos, tc.goarch, tc.tag)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err=%v want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Name != tc.want {
				t.Fatalf("name=%q want %q", got.Name, tc.want)
			}
		})
	}
}

func TestSafeAssetName(t *testing.T) {
	t.Parallel()
	for _, name := range []string{
		"tailcat-box-macos-arm64-v0.1.0.zip",
		"tailcat-box-macos-arm64-v0.4.0.dmg",
		"tailcat-box-windows-amd64-v0.4.0.exe",
		"tailcat-box-windows-amd64-installer-v1.1.1.exe",
	} {
		got, err := SafeAssetName(name)
		if err != nil || got != name {
			t.Fatalf("SafeAssetName(%q)=%q %v", name, got, err)
		}
	}
	for _, name := range []string{"../evil.zip", "foo.txt", "a/b.zip", "zip", "..", "tail cat.zip", "setup.msi"} {
		if _, err := SafeAssetName(name); err == nil {
			t.Fatalf("SafeAssetName(%q) succeeded", name)
		}
	}
}
