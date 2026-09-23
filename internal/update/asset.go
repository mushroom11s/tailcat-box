package update

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ErrUnsupportedPlatform means this GOOS/GOARCH has no release target.
var ErrUnsupportedPlatform = errors.New("unsupported platform")

// ErrNoAsset means the release has no zip for this GOOS/GOARCH.
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

// SelectAsset picks the zip for goos/goarch from a release's assets.
// tag is the release tag, usually vX.Y.Z, matching the workflow file name.
func SelectAsset(assets []Asset, goos, goarch, tag string) (Asset, error) {
	slug, arch, err := PlatformSlug(goos, goarch)
	if err != nil {
		return Asset{}, err
	}
	index := make(map[string]Asset, len(assets))
	for _, asset := range assets {
		if strings.TrimSpace(asset.Name) == "" || strings.TrimSpace(asset.URL) == "" {
			continue
		}
		index[strings.ToLower(asset.Name)] = asset
	}
	for _, name := range candidateNames(slug, arch, tag) {
		if asset, ok := index[strings.ToLower(name)]; ok {
			return asset, nil
		}
	}
	return fallbackAsset(assets, slug, arch, tag)
}

func candidateNames(slug, arch, tag string) []string {
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
	if tag != "" {
		add(fmt.Sprintf("tailcat-box-%s-%s-%s.zip", slug, arch, tag))
	}
	if bare != "" {
		add(fmt.Sprintf("tailcat-box-%s-%s-v%s.zip", slug, arch, bare))
		add(fmt.Sprintf("tailcat-box-%s-%s-%s.zip", slug, arch, bare))
	}
	return names
}

func fallbackAsset(assets []Asset, slug, arch, tag string) (Asset, error) {
	prefix := strings.ToLower(fmt.Sprintf("tailcat-box-%s-%s-", slug, arch))
	bare := strings.TrimPrefix(strings.TrimSpace(tag), "v")
	bare = strings.TrimPrefix(bare, "V")
	var matches []Asset
	for _, asset := range assets {
		name := strings.ToLower(strings.TrimSpace(asset.Name))
		if asset.URL == "" || !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".zip") {
			continue
		}
		matches = append(matches, asset)
	}
	if len(matches) == 0 {
		return Asset{}, ErrNoAsset
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	var narrowed []Asset
	tagLow := strings.ToLower(strings.TrimSpace(tag))
	for _, asset := range matches {
		name := strings.ToLower(asset.Name)
		if (tagLow != "" && strings.Contains(name, tagLow)) || (bare != "" && strings.Contains(name, strings.ToLower(bare))) {
			narrowed = append(narrowed, asset)
		}
	}
	if len(narrowed) == 1 {
		return narrowed[0], nil
	}
	return Asset{}, ErrNoAsset
}

// SafeAssetName accepts a release zip name and rejects paths.
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
	if !strings.HasSuffix(strings.ToLower(name), ".zip") {
		return "", errors.New("invalid asset name")
	}
	return name, nil
}
