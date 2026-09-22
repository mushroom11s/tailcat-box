package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	inboxDirName   = "chat-inbox"
	partialDirName = "chat-partials"
)

// fileChunkSize is the resume chunk payload. Tests may shrink it.
var fileChunkSize = 256 * 1024

var transferIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{8,80}$`)

func cleanFileName(name string) (string, error) {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("empty name")
	}
	return name, nil
}

func validTransferID(id string) bool {
	return transferIDPattern.MatchString(id)
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func hashReader(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readFileAt(path string, offset int64, n int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	got, err := f.ReadAt(buf, offset)
	if err != nil && err != io.EOF {
		return nil, err
	}
	return buf[:got], nil
}

func sweepChatDir(root, name string) error {
	if root == "" {
		return nil
	}
	dir := filepath.Join(root, name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func partialPath(root, id string) (string, error) {
	if root == "" || !validTransferID(id) {
		return "", fmt.Errorf("invalid transfer id")
	}
	return filepath.Join(root, partialDirName, id), nil
}

func inboxFilePath(root, id string) (string, error) {
	if root == "" || !validTransferID(id) {
		return "", fmt.Errorf("invalid transfer id")
	}
	return filepath.Join(root, inboxDirName, id), nil
}

func managedPath(root, filePath string) bool {
	if root == "" || filePath == "" {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return false
	}
	for _, name := range []string{inboxDirName, partialDirName} {
		dir := filepath.Join(absRoot, name)
		if absFile == dir {
			continue
		}
		if strings.HasPrefix(absFile, dir+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}

// applyPrefix writes the bytes of chunk that extend the contiguous prefix at path.
// A gap (offset beyond the stored length) is rejected and leaves the file unchanged.
// Overlap writes only the new tail.
func applyPrefix(filePath string, offset int64, chunk []byte) (int64, bool, error) {
	if offset < 0 {
		return 0, false, fmt.Errorf("negative offset")
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return 0, false, err
	}
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return 0, false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, false, err
	}
	have := info.Size()
	if offset > have {
		return have, false, nil
	}
	start := have - offset
	if start >= int64(len(chunk)) {
		return have, true, nil
	}
	tail := chunk[start:]
	if _, err := f.WriteAt(tail, have); err != nil {
		return have, false, err
	}
	return have + int64(len(tail)), true, nil
}

func fileLen(filePath string) int64 {
	info, err := os.Stat(filePath)
	if err != nil {
		return 0
	}
	return info.Size()
}

func writeInboxBytes(root, id string, data []byte) (string, error) {
	dest, err := inboxFilePath(root, id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}

func moveToInbox(root, id, src string) (string, error) {
	dest, err := inboxFilePath(root, id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(src, dest); err != nil {
		in, openErr := os.Open(src)
		if openErr != nil {
			return "", err
		}
		defer in.Close()
		out, createErr := os.Create(dest)
		if createErr != nil {
			return "", createErr
		}
		if _, copyErr := io.Copy(out, in); copyErr != nil {
			out.Close()
			return "", copyErr
		}
		if closeErr := out.Close(); closeErr != nil {
			return "", closeErr
		}
		_ = os.Remove(src)
	}
	return dest, nil
}

func asInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case int64:
		return n
	case jsonNumber:
		i, _ := n.Int64()
		return i
	default:
		return 0
	}
}

// jsonNumber matches encoding/json.Number without importing it in the signature.
type jsonNumber interface {
	Int64() (int64, error)
}

func applyBurn(meta map[string]any, burn bool, ttl int) {
	if !burn {
		return
	}
	meta["burn"] = true
	meta["ttlSec"] = clampTTL(ttl)
}

func clampTTL(ttl int) int {
	if ttl < 0 {
		return 0
	}
	if ttl > 30 {
		return 30
	}
	return ttl
}

func readBurn(meta map[string]any) (bool, int) {
	burn, _ := meta["burn"].(bool)
	if !burn {
		return false, 0
	}
	return true, clampTTL(int(asInt(meta["ttlSec"])))
}

func hasCap(caps []string, name string) bool {
	for _, cap := range caps {
		if cap == name {
			return true
		}
	}
	return false
}

func mimeForName(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ext == "" {
		return "application/octet-stream"
	}
	// Local table keeps tests independent of the OS mime database.
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".txt":
		return "text/plain"
	case ".pdf":
		return "application/pdf"
	case ".json":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
