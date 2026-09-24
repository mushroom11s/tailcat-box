package update

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ErrUnsupportedPlatform means this GOOS/GOARCH has no release target.
var ErrUnsupportedPlatform = errors.New("unsupported platform")

// ErrNoAsset means the release has no installer (or legacy zip) for this GOOS/GOARCH.
var ErrNoAsset = errors.New("no matching asset")

// Asset is one file attached to a GitHub release.
type Asset struct {
	Name string
	URL  string
	Size int64
}

// PlatformSlug maps Go's OS/arch names onto the Release workflow slugs.
func PlatformSlug(goos, goarch string) (slug, arch string, err error) {
	switch goos {
	case "darwin":
		slug = "macos"
	case "windows":
		slug = "windows"
	default:
		return "", "", ErrUnsupportedPlatform
	}
	switch goarch {
	case "amd64", "arm64":
	default:
		return "", "", ErrUnsupportedPlatform
	}
	return slug, goarch, nil
}

// SelectAsset picks the installer for goos/goarch from a release's assets.
// macOS prefers .dmg and Windows prefers .exe. Older .zip assets still match
// so releases published before the installer switch keep downloading.
// tag is the release tag, usually vX.Y.Z, matching the workflow file name.
func SelectAsset(assets []Asset, goos, goarch, tag string) (Asset, error) {
	slug, arch, err := PlatformSlug(goos, goarch)
	if err != nil {
		return Asset{}, err
	}
	exts := platformExts(goos)
	index := make(map[string]Asset, len(assets))
	for _, asset := range assets {
		if strings.TrimSpace(asset.Name) == "" || strings.TrimSpace(asset.URL) == "" {
			continue
		}
		index[strings.ToLower(asset.Name)] = asset
	}
	for _, name := range candidateNames(slug, arch, tag, exts) {
		if asset, ok := index[strings.ToLower(name)]; ok {
			return asset, nil
		}
	}
	return fallbackAsset(assets, slug, arch, tag, exts)
}

func platformExts(goos string) []string {
	switch goos {
	case "darwin":
		return []string{".dmg", ".zip"}
	case "windows":
		return []string{".exe", ".zip"}
	default:
		return []string{".zip"}
	}
}

func candidateNames(slug, arch, tag string, exts []string) []string {
	tag = strings.TrimSpace(tag)
	bare := strings.TrimPrefix(tag, "v")
	bare = strings.TrimPrefix(bare, "V")
	var names []string
	add := func(name string) {
		for _, existing := range names {
			if strings.EqualFold(existing, name) {
				return
			}
		}
		names = append(names, name)
	}
	for _, ext := range exts {
		if tag != "" {
			add(fmt.Sprintf("tailcat-box-%s-%s-%s%s", slug, arch, tag, ext))
		}
		if bare != "" {
			add(fmt.Sprintf("tailcat-box-%s-%s-v%s%s", slug, arch, bare, ext))
			add(fmt.Sprintf("tailcat-box-%s-%s-%s%s", slug, arch, bare, ext))
		}
	}
	return names
}

func fallbackAsset(assets []Asset, slug, arch, tag string, exts []string) (Asset, error) {
	prefix := strings.ToLower(fmt.Sprintf("tailcat-box-%s-%s-", slug, arch))
	byExt := map[string][]Asset{}
	for _, asset := range assets {
		name := strings.ToLower(strings.TrimSpace(asset.Name))
		if asset.URL == "" || !strings.HasPrefix(name, prefix) {
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))
		if !containsExt(exts, ext) {
			continue
		}
		byExt[ext] = append(byExt[ext], asset)
	}
	for _, ext := range exts {
		chosen, ok := chooseOne(byExt[ext], tag)
		if ok {
			return chosen, nil
		}
		if len(byExt[ext]) > 0 {
			return Asset{}, ErrNoAsset
		}
	}
	return Asset{}, ErrNoAsset
}

func chooseOne(matches []Asset, tag string) (Asset, bool) {
	if len(matches) == 1 {
		return matches[0], true
	}
	if len(matches) == 0 {
		return Asset{}, false
	}
	bare := strings.TrimPrefix(strings.TrimSpace(tag), "v")
	bare = strings.TrimPrefix(bare, "V")
	var narrowed []Asset
	tagLow := strings.ToLower(strings.TrimSpace(tag))
	for _, asset := range matches {
		name := strings.ToLower(asset.Name)
		if (tagLow != "" && strings.Contains(name, tagLow)) || (bare != "" && strings.Contains(name, strings.ToLower(bare))) {
			narrowed = append(narrowed, asset)
		}
	}
	if len(narrowed) == 1 {
		return narrowed[0], true
	}
	return Asset{}, false
}

func containsExt(exts []string, ext string) bool {
	for _, candidate := range exts {
		if candidate == ext {
			return true
		}
	}
	return false
}

// SafeAssetName accepts a release installer or legacy zip name and rejects paths.
func SafeAssetName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return "", errors.New("invalid asset name")
	}
	name = filepath.Base(name)
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
		default:
			return "", errors.New("invalid asset name")
		}
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".zip", ".dmg", ".exe":
		return name, nil
	default:
		return "", errors.New("invalid asset name")
	}
}
