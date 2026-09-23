package update

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"
)

const (
	// DefaultLatestURL is the GitHub API for the newest stable release.
	DefaultLatestURL = "https://api.github.com/repos/mushroom11s/tailcat-box/releases/latest"

	// StatusUpToDate means the running version is not older than the release.
	StatusUpToDate = "upToDate"
	// StatusAvailable means a newer release has a zip for this machine.
	StatusAvailable = "available"
	// StatusDownloaded means that zip is already in Downloads.
	StatusDownloaded = "downloaded"
	// StatusUnsupported means this OS has no published package.
	StatusUnsupported = "unsupported"
	// StatusError means the check failed and must not advertise an update.
	StatusError = "error"

	// ErrNetwork is a transport or HTTP failure.
	ErrNetwork = "network"
	// ErrRateLimit is a GitHub rate-limit response.
	ErrRateLimit = "rate_limit"
	// ErrParse means the release payload could not be used.
	ErrParse = "parse"
	// ErrNoPackage is the settings code when no zip matches this machine.
	ErrNoPackage = "no_asset"
	// ErrPlatform is the settings code when GOOS/GOARCH is not a release target.
	ErrPlatform = "unsupported"
	// ErrDownload is a failed zip download. The update can still be retried.
	ErrDownload = "download"
)

const (
	apiTimeout     = 20 * time.Second
	apiBodyLimit   = 2 << 20
	notesRuneLimit = 500
)

// Config selects the release feed and the machine the asset must match.
type Config struct {
	CurrentVersion string
	LatestURL      string
	HTTPClient     *http.Client
	GOOS           string
	GOARCH         string
	DownloadsDir   string
	// PermissiveAssets allows non-GitHub download URLs. Tests use it.
	PermissiveAssets bool
	UserAgent        string
}

// Result is one finished update check.
type Result struct {
	CurrentVersion string
	LatestVersion  string
	LatestTag      string
	ReleaseURL     string
	Notes          string
	AssetName      string
	DownloadURL    string
	Status         string
	Error          string
	Platform       string
}

// Checker talks to GitHub Releases.
type Checker struct {
	cfg Config
}

// New returns a checker. Empty LatestURL uses the public GitHub API.
func New(cfg Config) *Checker {
	if strings.TrimSpace(cfg.LatestURL) == "" {
		cfg.LatestURL = DefaultLatestURL
	}
	if strings.TrimSpace(cfg.UserAgent) == "" {
		cfg.UserAgent = UserAgent(cfg.CurrentVersion)
	}
	if cfg.GOOS == "" {
		cfg.GOOS = runtime.GOOS
	}
	if cfg.GOARCH == "" {
		cfg.GOARCH = runtime.GOARCH
	}
	return &Checker{cfg: cfg}
}

// UserAgent identifies Tailcat Box to the GitHub API.
func UserAgent(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		version = "dev"
	}
	return "TailcatBox/" + version + " (+https://github.com/mushroom11s/tailcat-box)"
}

// Check fetches the latest stable release and compares it with CurrentVersion.
// Transport and parse failures are reported on Result and do not return an error.
func (c *Checker) Check(ctx context.Context) Result {
	base := Result{
		CurrentVersion: strings.TrimSpace(c.cfg.CurrentVersion),
		Platform:       c.cfg.GOOS,
		Status:         StatusError,
		Error:          ErrNetwork,
	}
	rel, err := c.fetchLatest(ctx)
	if err != nil {
		base.Error = errorCode(err)
		return base
	}
	if rel.Draft || rel.Prerelease || strings.TrimSpace(rel.TagName) == "" {
		base.Error = ErrParse
		return base
	}
	latest, err := ParseVersion(rel.TagName)
	if err != nil {
		base.Error = ErrParse
		return base
	}
	if _, err := ParseVersion(base.CurrentVersion); err != nil {
		base.Error = ErrParse
		return base
	}
	base.Error = ""
	base.LatestTag = strings.TrimSpace(rel.TagName)
	base.LatestVersion = latest.String()
	base.ReleaseURL = strings.TrimSpace(rel.HTMLURL)
	if base.ReleaseURL == "" {
		base.ReleaseURL = "https://github.com/mushroom11s/tailcat-box/releases/tag/" + base.LatestTag
	}
	base.Notes = Excerpt(rel.Body, notesRuneLimit)

	newer, err := IsNewer(base.LatestVersion, base.CurrentVersion)
	if err != nil {
		base.Status = StatusError
		base.Error = ErrParse
		return base
	}
	if !newer {
		base.Status = StatusUpToDate
		return base
	}
	assets := make([]Asset, 0, len(rel.Assets))
	for _, asset := range rel.Assets {
		assets = append(assets, Asset{Name: asset.Name, URL: asset.BrowserDownloadURL, Size: asset.Size})
	}
	match, err := SelectAsset(assets, c.cfg.GOOS, c.cfg.GOARCH, base.LatestTag)
	if err != nil {
		base.Status = StatusUnsupported
		if errors.Is(err, ErrUnsupportedPlatform) {
			base.Error = ErrPlatform
		} else {
			base.Error = ErrNoPackage
		}
		return base
	}
	base.Status = StatusAvailable
	base.AssetName = match.Name
	base.DownloadURL = match.URL
	return base
}

type ghRelease struct {
	TagName    string    `json:"tag_name"`
	Draft      bool      `json:"draft"`
	Prerelease bool      `json:"prerelease"`
	HTMLURL    string    `json:"html_url"`
	Body       string    `json:"body"`
	Assets     []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

func (c *Checker) fetchLatest(ctx context.Context) (ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.LatestURL, nil)
	if err != nil {
		return ghRelease{}, errParseSentinel
	}
	req.Header.Set("User-Agent", c.cfg.UserAgent)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := c.client(apiTimeout).Do(req)
	if err != nil {
		return ghRelease{}, errNetworkSentinel
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, apiBodyLimit))
	if err != nil {
		return ghRelease{}, errNetworkSentinel
	}
	if rateLimited(resp, body) {
		return ghRelease{}, errRateSentinel
	}
	if resp.StatusCode == http.StatusNotFound {
		return ghRelease{}, errParseSentinel
	}
	if resp.StatusCode != http.StatusOK {
		return ghRelease{}, errNetworkSentinel
	}
	var rel ghRelease
	if err := json.Unmarshal(body, &rel); err != nil {
		return ghRelease{}, errParseSentinel
	}
	return rel, nil
}

func (c *Checker) client(timeout time.Duration) *http.Client {
	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			if !allowedRedirect(req.URL, c.cfg.PermissiveAssets) {
				return errors.New("redirect blocked")
			}
			return nil
		},
	}
	if c.cfg.HTTPClient != nil {
		client.Transport = c.cfg.HTTPClient.Transport
		client.Jar = c.cfg.HTTPClient.Jar
	}
	return client
}

var (
	errNetworkSentinel = errors.New("network")
	errRateSentinel    = errors.New("rate_limit")
	errParseSentinel   = errors.New("parse")
)

func errorCode(err error) string {
	switch {
	case errors.Is(err, errRateSentinel):
		return ErrRateLimit
	case errors.Is(err, errParseSentinel):
		return ErrParse
	default:
		return ErrNetwork
	}
}

func rateLimited(resp *http.Response, body []byte) bool {
	if resp.StatusCode != http.StatusForbidden && resp.StatusCode != http.StatusTooManyRequests {
		return false
	}
	if resp.Header.Get("X-RateLimit-Remaining") == "0" {
		return true
	}
	return strings.Contains(strings.ToLower(string(body)), "rate limit")
}

// Excerpt trims a release body to limit runes.
func Excerpt(body string, limit int) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	body = strings.TrimSpace(body)
	if body == "" || limit <= 0 {
		return ""
	}
	runes := []rune(body)
	if len(runes) <= limit {
		return body
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}
