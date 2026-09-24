package update

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const maxDownloadBytes int64 = 1 << 30

// Progress is emitted while an installer is written.
type Progress struct {
	Received int64
	Total    int64
	Percent  int
}

// Download saves assetName from rawURL into the Downloads directory.
func (c *Checker) Download(ctx context.Context, rawURL, assetName string, onProgress func(Progress)) (string, error) {
	if err := validateAssetURL(rawURL, c.cfg.PermissiveAssets); err != nil {
		return "", err
	}
	name, err := SafeAssetName(assetName)
	if err != nil {
		return "", err
	}
	dir := c.cfg.DownloadsDir
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, "Downloads")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", c.cfg.UserAgent)
	req.Header.Set("Accept", "application/octet-stream")
	resp, err := c.client(0).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New("download failed")
	}
	if resp.ContentLength > maxDownloadBytes {
		return "", errors.New("download too large")
	}
	tmp := filepath.Join(dir, name+".partial")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	closed := false
	ok := false
	defer func() {
		if !closed {
			_ = f.Close()
		}
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := copyProgress(f, resp.Body, resp.ContentLength, onProgress); err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	closed = true
	dest := filepath.Join(dir, name)
	if err := os.Remove(dest); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(tmp, dest); err != nil {
		return "", err
	}
	ok = true
	return dest, nil
}

func copyProgress(dst io.Writer, src io.Reader, total int64, onProgress func(Progress)) (int64, error) {
	buf := make([]byte, 32*1024)
	var written int64
	report := func(done bool) {
		if onProgress == nil {
			return
		}
		p := Progress{Received: written, Total: total}
		if total > 0 {
			p.Percent = int(written * 100 / total)
			if p.Percent > 100 {
				p.Percent = 100
			}
		}
		if done {
			p.Percent = 100
		}
		onProgress(p)
	}
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return written, werr
			}
			written += int64(n)
			if written > maxDownloadBytes {
				return written, errors.New("download too large")
			}
			report(false)
		}
		if errors.Is(err, io.EOF) {
			report(true)
			return written, nil
		}
		if err != nil {
			return written, err
		}
	}
}
