package miao

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

const (
	shareStateName    = "share.json"
	shareStateVersion = 1
)

var errShareUnready = fmt.Errorf("A share could not be restored.")

type roomKeyer interface {
	GeneratePrivateKeyJSON() (string, error)
}

type shareFile struct {
	Name        string `json:"name"`
	StorageName string `json:"storage"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

// shareRecord is the on-disk copy of one active share. The room key stays here
// so a restart can listen on the same Tailcat address and keep the same code.
type shareRecord struct {
	V            int         `json:"v"`
	ID           string      `json:"id"`
	Token        string      `json:"token"`
	KeyJSON      string      `json:"key"`
	Address      string      `json:"address"`
	Payload      string      `json:"payload"`
	CreatedAt    string      `json:"createdAt"`
	Forever      bool        `json:"forever"`
	TTLDays      int         `json:"ttlDays"`
	ExpiresAt    string      `json:"expiresAt"`
	MaxDownloads int         `json:"maxDownloads"`
	Downloads    int         `json:"downloads"`
	Total        int64       `json:"total"`
	Files        []shareFile `json:"files"`
	Region       string      `json:"region,omitempty"`
	DERPMapURL   string      `json:"derpMapUrl,omitempty"`
}

func (s *Service) newRoomKey() (string, error) {
	gen, ok := s.ad.(roomKeyer)
	if !ok {
		return "", fmt.Errorf("share key is not available")
	}
	key, err := gen.GeneratePrivateKeyJSON()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(key) == "" {
		return "", fmt.Errorf("share key is not available")
	}
	return key, nil
}

func (h *host) writeStateLocked() error {
	if h.dir == "" || h.id == "" || h.token == "" || strings.TrimSpace(h.keyJSON) == "" {
		return fmt.Errorf("share state is incomplete")
	}
	rec := shareRecord{
		V:            shareStateVersion,
		ID:           h.id,
		Token:        h.token,
		KeyJSON:      h.keyJSON,
		Address:      h.address,
		Payload:      h.payload,
		CreatedAt:    formatRecordTime(h.createdAt),
		Forever:      h.forever,
		TTLDays:      h.lim.TTLDays,
		MaxDownloads: h.lim.MaxDownloads,
		Downloads:    h.downloads,
		Total:        h.total,
		Region:       h.region,
		DERPMapURL:   h.derpURL,
	}
	if !h.forever {
		rec.ExpiresAt = formatRecordTime(h.expires)
	}
	rec.Files = make([]shareFile, 0, len(h.files))
	for _, file := range h.files {
		rec.Files = append(rec.Files, shareFile{
			Name:        file.Name,
			StorageName: file.StorageName,
			Size:        file.Size,
			SHA256:      file.SHA256,
		})
	}
	return writeShareRecord(h.dir, rec)
}

func writeShareRecord(dir string, rec shareRecord) error {
	if rec.V == 0 {
		rec.V = shareStateVersion
	}
	path := filepath.Join(dir, shareStateName)
	if err := writeJSONAtomic(path, rec); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func loadShareRecord(dir string) (*shareRecord, error) {
	body, err := os.ReadFile(filepath.Join(dir, shareStateName))
	if err != nil {
		return nil, err
	}
	var rec shareRecord
	if err := json.Unmarshal(body, &rec); err != nil {
		return nil, err
	}
	if rec.V != shareStateVersion || rec.ID == "" || strings.TrimSpace(rec.Token) == "" || strings.TrimSpace(rec.KeyJSON) == "" {
		return nil, fmt.Errorf("bad share state")
	}
	return &rec, nil
}

func (rec *shareRecord) finished(now time.Time) bool {
	if rec.MaxDownloads > 0 && rec.Downloads >= rec.MaxDownloads {
		return true
	}
	if rec.Forever {
		return false
	}
	expires, ok := parseRecordTime(rec.ExpiresAt)
	if !ok || !now.Before(expires) {
		return true
	}
	return false
}

func (rec *shareRecord) stagedFiles(dir string) ([]StagedFile, error) {
	if len(rec.Files) == 0 {
		return nil, ErrShareMissing
	}
	out := make([]StagedFile, 0, len(rec.Files))
	var total int64
	for _, file := range rec.Files {
		path, ok := stagedPath(dir, file.StorageName)
		if !ok {
			return nil, ErrShareMissing
		}
		sum, n, err := hashFile(path)
		if err != nil || file.Size < 0 || n != file.Size || !strings.EqualFold(sum, file.SHA256) {
			return nil, ErrShareMissing
		}
		out = append(out, StagedFile{
			Name:        file.Name,
			StorageName: file.StorageName,
			Path:        path,
			Size:        n,
			SHA256:      sum,
		})
		total += n
	}
	if rec.Total > 0 && rec.Total != total {
		return nil, ErrShareMissing
	}
	return out, nil
}

func (s *Service) restore() {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return
	}
	type item struct {
		dir string
		rec *shareRecord
		at  time.Time
	}
	var ready []item
	for _, entry := range entries {
		path := filepath.Join(s.root, entry.Name())
		if !entry.IsDir() {
			_ = os.Remove(path)
			continue
		}
		if entry.Name() == incomingDirName {
			continue
		}
		rec, err := loadShareRecord(path)
		if err != nil {
			_ = os.RemoveAll(path)
			continue
		}
		if rec.ID != entry.Name() || rec.finished(time.Now()) {
			_ = os.RemoveAll(path)
			continue
		}
		if _, err := rec.stagedFiles(path); err != nil {
			s.note(ErrShareMissing.Error())
			_ = os.RemoveAll(path)
			continue
		}
		created, _ := parseRecordTime(rec.CreatedAt)
		ready = append(ready, item{dir: path, rec: rec, at: created})
	}
	sort.Slice(ready, func(i, j int) bool {
		if ready[i].at.Equal(ready[j].at) {
			return ready[i].rec.ID > ready[j].rec.ID
		}
		return ready[i].at.After(ready[j].at)
	})
	for _, item := range ready {
		if err := s.resume(item.rec, item.dir); err != nil {
			s.note(err.Error())
		}
	}
}

func (s *Service) note(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	s.mu.Lock()
	s.notes = append(s.notes, msg)
	s.mu.Unlock()
}

func (s *Service) resume(rec *shareRecord, dir string) error {
	files, err := rec.stagedFiles(dir)
	if err != nil {
		s.note(ErrShareMissing.Error())
		_ = os.RemoveAll(dir)
		return nil
	}
	created, _ := parseRecordTime(rec.CreatedAt)
	if created.IsZero() {
		created = time.Now()
	}
	expires, hasExpiry := parseRecordTime(rec.ExpiresAt)
	if !rec.Forever && (!hasExpiry || !time.Now().Before(expires)) {
		_ = os.RemoveAll(dir)
		return nil
	}
	sess := &session.Session{
		ID:        rec.ID,
		Kind:      session.KindMiao,
		Status:    session.StatusStarting,
		CreatedAt: created,
	}
	ctx, cancel := context.WithCancel(context.Background())
	room, err := s.ad.StartRoom(ctx, adapter.RoomOpts{
		SessionID:      rec.ID,
		PrivateKeyJSON: rec.KeyJSON,
		Region:         rec.Region,
		DERPMapURL:     rec.DERPMapURL,
	})
	if err != nil {
		cancel()
		return errShareUnready
	}
	total := rec.Total
	if total <= 0 {
		for _, file := range files {
			total += file.Size
		}
	}
	h := &host{
		svc:       s,
		id:        rec.ID,
		token:     rec.Token,
		payload:   rec.Payload,
		address:   rec.Address,
		keyJSON:   rec.KeyJSON,
		dir:       dir,
		files:     files,
		total:     total,
		lim:       Limits{TTLDays: rec.TTLDays, MaxDownloads: rec.MaxDownloads, TTL: 0},
		forever:   rec.Forever,
		expires:   expires,
		downloads: rec.Downloads,
		sess:      sess,
		room:      room,
		cancel:    cancel,
		ctx:       ctx,
		ready:     make(chan struct{}),
		createdAt: created,
		region:    rec.Region,
		derpURL:   rec.DERPMapURL,
	}
	if rec.Forever {
		h.expires = time.Time{}
		h.lim.TTL = 0
	} else {
		h.lim.TTL = time.Until(expires)
	}
	s.mu.Lock()
	if s.hosts == nil {
		s.hosts = map[string]*host{}
	}
	s.hosts[h.id] = h
	s.order = append(s.order, h.id)
	s.mu.Unlock()
	go h.readLoop()
	select {
	case <-h.ready:
	case <-time.After(20 * time.Second):
		h.end("unready")
		return errShareUnready
	}
	h.mu.Lock()
	addr := h.address
	if addr == "" {
		addr = rec.Address
		h.address = addr
	}
	if addr != "" && (h.payload == "" || addr != rec.Address) {
		payload, encErr := EncodeJoin(addr, rec.Token)
		if encErr != nil {
			h.mu.Unlock()
			h.end("unready")
			return encErr
		}
		h.payload = payload
	}
	if h.payload == "" || h.address == "" {
		h.mu.Unlock()
		h.end("unready")
		return errShareUnready
	}
	if !h.forever && !h.expires.IsZero() {
		wait := time.Until(h.expires)
		if wait <= 0 {
			h.mu.Unlock()
			h.end("ttl")
			return nil
		}
		h.lim.TTL = wait
		h.timer = time.AfterFunc(wait, func() { h.end("ttl") })
	}
	if err := h.writeStateLocked(); err != nil {
		h.mu.Unlock()
		h.end("unready")
		return err
	}
	snap := h.snapshotLocked()
	h.mu.Unlock()
	h.publish(snap)
	return nil
}

func stagedPath(dir, name string) (string, bool) {
	if name == "" || name == "." || name == ".." || name == shareStateName || strings.ContainsAny(name, `/\`) {
		return "", false
	}
	if filepath.Base(name) != name {
		return "", false
	}
	path := filepath.Join(dir, name)
	rel, err := filepath.Rel(dir, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return path, true
}

func formatRecordTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseRecordTime(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "0001-01-01T00:00:00Z" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}
