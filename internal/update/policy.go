package update

import (
	"errors"
	"net/url"
	"strings"
)

const releaseDownloadPrefix = "/mushroom11s/tailcat-box/releases/download/"

func validateAssetURL(raw string, permissive bool) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if permissive {
		if u.Scheme != "http" && u.Scheme != "https" {
			return errors.New("unsupported download scheme")
		}
		if u.Host == "" {
			return errors.New("missing download host")
		}
		return nil
	}
	if u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return errors.New("download must use https")
	}
	if !strings.EqualFold(u.Hostname(), "github.com") {
		return errors.New("unexpected download host")
	}
	if !strings.HasPrefix(u.Path, releaseDownloadPrefix) {
		return errors.New("unexpected download path")
	}
	return nil
}

func allowedRedirect(u *url.URL, permissive bool) bool {
	if u == nil {
		return false
	}
	if permissive {
		return u.Scheme == "http" || u.Scheme == "https"
	}
	if u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "github.com",
		"release-assets.githubusercontent.com",
		"objects.githubusercontent.com",
		"github-releases.githubusercontent.com":
		return true
	default:
		return false
	}
}
