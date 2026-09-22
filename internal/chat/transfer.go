package chat

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

const (
	portFiles = 102

	errFileVerify = "File failed verification."
	modeResume    = "resume"
	modeFull      = "full"
	statusActive  = "active"
	statusError   = "error"
	statusDone    = "done"
)

type fileJob struct {
	id    string
	path  string
	name  string
	mime  string
	size  int64
	sha   string
	burn  bool
	ttl   int
	ready bool
}

type Transfer struct {
	ID     string `json:"id"`
	Offset int64  `json:"offset"`
	Size   int64  `json:"size"`
	Mode   string `json:"mode"`
	Status string `json:"status,omitempty"`
	Name   string `json:"name,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (s *Service) SetDataDir(dir string) {
	s.mu.Lock()
	s.dataDir = dir
	s.mu.Unlock()
	_ = sweepChatDir(dir, inboxDirName)
	_ = sweepChatDir(dir, partialDirName)
}

func (s *Service) PeerCaps() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.peerCaps...)
}

func (s *Service) Transfers() []Transfer {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Transfer, len(s.transfers))
	copy(out, s.transfers)
	return out
}

func (s *Service) SendTextBurn(body string, burn bool, ttlSec int) error {
	if strings.TrimSpace(body) == "" {
		return nil
	}
	s.mu.Lock()
	if s.peer == "" || s.room == nil || s.sess == nil {
		s.mu.Unlock()
		return fmt.Errorf("no peer")
	}
	room := s.room
	sid := s.sess.ID
	s.mu.Unlock()
	meta := map[string]any{"type": "text"}
	applyBurn(meta, burn, ttlSec)
	frame, err := Pack(meta, []byte(body))
	if err != nil {
		return err
	}
	if err := s.dial(s.transferContext(), room, portText, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	s.addText(sid, "out", body, burn, clampTTL(ttlSec))
	return nil
}

func (s *Service) SendFile(path string, burn bool, ttlSec int) (string, error) {
	job, err := newFileJob(path, burn, ttlSec)
	if err != nil {
		return "", err
	}
	return s.enqueue(job, false)
}

func (s *Service) Resend(id string) (string, error) {
	s.mu.Lock()
	job := s.failed[id]
	s.mu.Unlock()
	if job == nil {
		return "", fmt.Errorf("nothing to resend")
	}
	next := *job
	return s.enqueue(&next, true)
}

func (s *Service) Discard(id string) error {
	s.mu.Lock()
	var kept []Message
	var dropped *Message
	for i := range s.messages {
		if s.messages[i].ID == id {
			msg := s.messages[i]
			dropped = &msg
			continue
		}
		kept = append(kept, s.messages[i])
	}
	if dropped != nil {
		s.messages = kept
	}
	root := s.dataDir
	sid := ""
	if s.sess != nil {
		sid = s.sess.ID
	}
	s.mu.Unlock()
	if dropped == nil {
		return nil
	}
	s.deleteManaged(root, dropped.Path)
	notice, _ := marshalJSON(map[string]string{"id": dropped.ID})
	if dropped.FileID != "" {
		if partial, err := partialPath(root, dropped.FileID); err == nil {
			_ = os.Remove(partial)
		}
		if inbox, err := inboxFilePath(root, dropped.FileID); err == nil {
			_ = os.Remove(inbox)
		}
	}
	if inbox, err := inboxFilePath(root, dropped.ID); err == nil {
		_ = os.Remove(inbox)
	}
	if sid != "" {
		s.emit(adapter.Event{SessionID: sid, Kind: "discard", Data: string(notice)})
	}
	return nil
}

func (s *Service) FileName(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, msg := range s.messages {
		if msg.ID == id && msg.Name != "" {
			return msg.Name
		}
	}
	return "download"
}

func (s *Service) CopyFile(id, dest string) error {
	if dest == "" {
		return fmt.Errorf("destination is required")
	}
	s.mu.Lock()
	var src string
	for _, msg := range s.messages {
		if msg.ID == id {
			src = msg.Path
			break
		}
	}
	s.mu.Unlock()
	if src == "" {
		return fmt.Errorf("file is gone")
	}
	body, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, body, 0o644)
}

func newFileJob(path string, burn bool, ttlSec int) (*fileJob, error) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return nil, fmt.Errorf("file not found")
	}
	name, err := cleanFileName(path)
	if err != nil {
		return nil, err
	}
	return &fileJob{
		id:   newUUID(),
		path: path,
		name: name,
		mime: mimeForName(name),
		burn: burn,
		ttl:  clampTTL(ttlSec),
	}, nil
}

func (s *Service) enqueue(job *fileJob, keepID bool) (string, error) {
	if !keepID {
		// id already assigned
	}
	s.mu.Lock()
	if s.peer == "" || s.room == nil {
		s.mu.Unlock()
		return "", fmt.Errorf("no peer")
	}
	if s.sending {
		replaced := ""
		if s.queued != nil {
			replaced = "replaced"
		}
		s.queued = job
		s.mu.Unlock()
		return replaced, nil
	}
	s.sending = true
	ctx, cancel := context.WithCancel(context.Background())
	s.transferCancel = cancel
	s.mu.Unlock()
	go s.pump(ctx, job)
	return "", nil
}

func (s *Service) pump(ctx context.Context, job *fileJob) {
	for job != nil {
		s.runJob(ctx, job)
		s.mu.Lock()
		job = s.queued
		s.queued = nil
		if job == nil {
			s.sending = false
			if s.transferCancel != nil {
				s.transferCancel()
				s.transferCancel = nil
			}
		}
		s.mu.Unlock()
		if ctx.Err() != nil {
			return
		}
	}
}

func (s *Service) runJob(ctx context.Context, job *fileJob) {
	if !job.ready {
		sum, size, err := hashFile(job.path)
		if err != nil {
			s.failJob(job, err.Error())
			return
		}
		job.sha = sum
		job.size = size
		job.ready = true
	}
	caps := s.PeerCaps()
	if !hasCap(caps, "resume") {
		s.sendFull(ctx, job)
		return
	}
	s.sendResume(ctx, job)
}

func (s *Service) sendFull(ctx context.Context, job *fileJob) {
	room, sid, ok := s.roomSnapshot()
	if !ok {
		s.failJob(job, errUnreachable)
		return
	}
	payload, err := os.ReadFile(job.path)
	if err != nil {
		s.failJob(job, err.Error())
		return
	}
	meta := map[string]any{"type": "file", "name": job.name, "mime": job.mime}
	applyBurn(meta, job.burn, job.ttl)
	frame, err := Pack(meta, payload)
	if err != nil {
		s.failJob(job, err.Error())
		return
	}
	s.noteTransfer(sid, Transfer{ID: job.id, Offset: 0, Size: job.size, Mode: modeFull, Status: statusActive, Name: job.name})
	if err := s.dial(ctx, room, portFiles, frame); err != nil {
		s.failJob(job, errUnreachable)
		return
	}
	s.noteTransfer(sid, Transfer{ID: job.id, Offset: job.size, Size: job.size, Mode: modeFull, Status: statusDone, Name: job.name})
	s.addFileMessage(sid, "out", job, job.path, previewOf(job.mime, payload))
	s.clearFailed(job.id)
}

type handshakeStatus int

const (
	handshakeOK handshakeStatus = iota
	handshakeTimeout
	handshakeDial
)

func (s *Service) sendResume(ctx context.Context, job *fileJob) {
	fails := 0
	for {
		if ctx.Err() != nil {
			s.failJob(job, errUnreachable)
			return
		}
		offset, status := s.handshake(ctx, job)
		switch status {
		case handshakeDial:
			s.failJob(job, errUnreachable)
			return
		case handshakeTimeout:
			s.sendFull(ctx, job)
			return
		}
		if offset < 0 {
			offset = 0
		}
		if offset > job.size {
			offset = job.size
		}
		s.noteTransfer(s.sessionID(), Transfer{ID: job.id, Offset: offset, Size: job.size, Mode: modeResume, Status: statusActive, Name: job.name})
		if offset >= job.size {
			s.finishResume(job)
			return
		}
		for offset < job.size {
			n := fileChunkSize
			remain := job.size - offset
			if remain < int64(n) {
				n = int(remain)
			}
			chunk, err := readFileAt(job.path, offset, n)
			if err != nil || len(chunk) != n {
				s.failJob(job, errUnreachable)
				return
			}
			meta := map[string]any{
				"type":   "file-chunk",
				"id":     job.id,
				"name":   job.name,
				"mime":   job.mime,
				"size":   job.size,
				"sha256": job.sha,
				"offset": offset,
			}
			applyBurn(meta, job.burn, job.ttl)
			frame, err := Pack(meta, chunk)
			if err != nil {
				s.failJob(job, err.Error())
				return
			}
			room, _, ok := s.roomSnapshot()
			if !ok {
				s.failJob(job, errUnreachable)
				return
			}
			if err := s.dial(ctx, room, portFiles, frame); err != nil {
				fails++
				if fails >= 3 {
					s.failJob(job, errUnreachable)
					return
				}
				break
			}
			fails = 0
			offset += int64(len(chunk))
			s.noteTransfer(s.sessionID(), Transfer{ID: job.id, Offset: offset, Size: job.size, Mode: modeResume, Status: statusActive, Name: job.name})
		}
		if offset >= job.size {
			s.finishResume(job)
			return
		}
	}
}

func (s *Service) finishResume(job *fileJob) {
	sid := s.sessionID()
	payload, err := os.ReadFile(job.path)
	preview := ""
	if err == nil {
		preview = previewOf(job.mime, payload)
	}
	s.noteTransfer(sid, Transfer{ID: job.id, Offset: job.size, Size: job.size, Mode: modeResume, Status: statusDone, Name: job.name})
	s.addFileMessage(sid, "out", job, job.path, preview)
	s.clearFailed(job.id)
}

func (s *Service) handshake(ctx context.Context, job *fileJob) (int64, handshakeStatus) {
	room, _, local, ok := s.roomDetail()
	if !ok || local == "" {
		return 0, handshakeDial
	}
	ch := make(chan int64, 1)
	s.mu.Lock()
	if s.offsetWait == nil {
		s.offsetWait = map[string]chan int64{}
	}
	s.offsetWait[job.id] = ch
	wait := s.offsetWaitFor
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.offsetWait, job.id)
		s.mu.Unlock()
	}()
	meta := map[string]any{
		"type":    "file-begin",
		"id":      job.id,
		"name":    job.name,
		"mime":    job.mime,
		"size":    job.size,
		"sha256":  job.sha,
		"replyTo": local,
	}
	applyBurn(meta, job.burn, job.ttl)
	frame, err := Pack(meta, nil)
	if err != nil {
		return 0, handshakeDial
	}
	if err := s.dial(ctx, room, portControl, frame); err != nil {
		return 0, handshakeDial
	}
	if wait <= 0 {
		wait = 10 * time.Second
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, handshakeDial
	case off := <-ch:
		return off, handshakeOK
	case <-timer.C:
		return 0, handshakeTimeout
	}
}

func (s *Service) failJob(job *fileJob, message string) {
	s.mu.Lock()
	if s.failed == nil {
		s.failed = map[string]*fileJob{}
	}
	copied := *job
	s.failed[job.id] = &copied
	sid := ""
	if s.sess != nil {
		sid = s.sess.ID
	}
	s.mu.Unlock()
	mode := modeResume
	if !hasCap(s.PeerCaps(), "resume") {
		mode = modeFull
	}
	s.noteTransfer(sid, Transfer{ID: job.id, Offset: 0, Size: job.size, Mode: mode, Status: statusError, Name: job.name, Error: message})
}

func (s *Service) clearFailed(id string) {
	s.mu.Lock()
	delete(s.failed, id)
	s.mu.Unlock()
}

func (s *Service) noteTransfer(sessionID string, tr Transfer) {
	s.mu.Lock()
	replaced := false
	for i := range s.transfers {
		if s.transfers[i].ID == tr.ID {
			s.transfers[i] = tr
			replaced = true
			break
		}
	}
	if !replaced {
		s.transfers = append(s.transfers, tr)
	}
	s.mu.Unlock()
	if sessionID == "" {
		return
	}
	body, _ := jsonMarshal(tr)
	s.emit(adapter.Event{SessionID: sessionID, Kind: "transfer", Data: string(body)})
}

func (s *Service) dial(ctx context.Context, room adapter.Room, port uint16, frame []byte) error {
	if room == nil {
		return fmt.Errorf("room closed")
	}
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return room.SendEnvelope(cctx, port, frame)
}

func (s *Service) transferContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.roomCtx != nil {
		return s.roomCtx
	}
	return context.Background()
}

func (s *Service) roomSnapshot() (adapter.Room, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room == nil || s.sess == nil {
		return nil, "", false
	}
	return s.room, s.sess.ID, true
}

func (s *Service) roomDetail() (adapter.Room, string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room == nil || s.sess == nil {
		return nil, "", "", false
	}
	return s.room, s.sess.ID, s.sess.Address, true
}

func (s *Service) sessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sess == nil {
		return ""
	}
	return s.sess.ID
}

func (s *Service) onFileBegin(meta map[string]any) {
	id, _ := meta["id"].(string)
	if !validTransferID(id) {
		return
	}
	replyTo, _ := meta["replyTo"].(string)
	root := s.rootDir()
	partial, err := partialPath(root, id)
	offset := int64(0)
	if err == nil {
		offset = fileLen(partial)
	}
	frame, err := Pack(map[string]any{"type": "file-offset", "id": id, "offset": offset}, nil)
	if err != nil {
		return
	}
	s.mu.Lock()
	room := s.room
	prev := s.peer
	parent := s.roomCtx
	s.mu.Unlock()
	if room == nil {
		return
	}
	if parent == nil {
		parent = context.Background()
	}
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if strings.HasPrefix(replyTo, "tc") && replyTo != prev {
		_ = room.SetPeer(replyTo)
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	err = room.SendEnvelope(ctx, portControl, frame)
	cancel()
	if strings.HasPrefix(replyTo, "tc") && replyTo != prev {
		_ = room.SetPeer(prev)
	}
	_ = err
}

func (s *Service) onFileChunk(sessionID string, meta map[string]any, payload []byte) {
	id, _ := meta["id"].(string)
	if !validTransferID(id) {
		return
	}
	name, err := cleanFileName(stringField(meta, "name"))
	if err != nil {
		return
	}
	mimeType := stringField(meta, "mime")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	size := asInt(meta["size"])
	want := strings.ToLower(stringField(meta, "sha256"))
	offset := asInt(meta["offset"])
	burn, ttl := readBurn(meta)
	root := s.rootDir()
	partial, err := partialPath(root, id)
	if err != nil {
		return
	}
	got, accepted, err := applyPrefix(partial, offset, payload)
	if err != nil || !accepted {
		return
	}
	if size > 0 && got < size {
		s.noteTransfer(sessionID, Transfer{ID: id, Offset: got, Size: size, Mode: modeResume, Status: statusActive, Name: name})
		return
	}
	if size > 0 && got != size {
		return
	}
	sum, _, err := hashFile(partial)
	if err != nil || (want != "" && sum != want) {
		_ = os.Remove(partial)
		s.addSystem(sessionID, "file-verify", errFileVerify)
		s.noteTransfer(sessionID, Transfer{ID: id, Offset: 0, Size: size, Mode: modeResume, Status: statusError, Name: name, Error: errFileVerify})
		return
	}
	dest, err := moveToInbox(root, id, partial)
	if err != nil {
		return
	}
	body, _ := os.ReadFile(dest)
	s.addIncomingFile(sessionID, id, name, mimeType, size, dest, burn, ttl, previewOf(mimeType, body))
	s.noteTransfer(sessionID, Transfer{ID: id, Offset: size, Size: size, Mode: modeResume, Status: statusDone, Name: name})
}

func (s *Service) onWholeFile(sessionID string, meta map[string]any, payload []byte) {
	name, err := cleanFileName(stringField(meta, "name"))
	if err != nil {
		return
	}
	mimeType := stringField(meta, "mime")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	burn, ttl := readBurn(meta)
	id := newUUID()
	root := s.rootDir()
	dest := ""
	if root != "" {
		if path, err := writeInboxBytes(root, id, payload); err == nil {
			dest = path
		}
	}
	s.addIncomingFile(sessionID, id, name, mimeType, int64(len(payload)), dest, burn, ttl, previewOf(mimeType, payload))
}

func (s *Service) deliverOffset(id string, offset int64) {
	s.mu.Lock()
	ch := s.offsetWait[id]
	s.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- offset:
	default:
	}
}

func (s *Service) addIncomingFile(sessionID, fileID, name, mimeType string, size int64, path string, burn bool, ttl int, preview string) {
	msg := newMessage("in", "file", "", "")
	msg.Name = name
	msg.Mime = mimeType
	msg.Size = size
	msg.Path = path
	msg.FileID = fileID
	msg.Burn = burn
	if burn {
		msg.TTLSec = ttl
	}
	msg.Preview = preview
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}

func (s *Service) addFileMessage(sessionID, direction string, job *fileJob, path, preview string) {
	msg := newMessage(direction, "file", "", "")
	msg.Name = job.name
	msg.Mime = job.mime
	msg.Size = job.size
	msg.Path = path
	msg.FileID = job.id
	msg.Burn = job.burn
	if job.burn {
		msg.TTLSec = job.ttl
	}
	msg.Preview = preview
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}

func (s *Service) rootDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dataDir
}

func (s *Service) deleteManaged(root, path string) {
	if managedPath(root, path) {
		_ = os.Remove(path)
	}
}

func stringField(meta map[string]any, key string) string {
	v, _ := meta[key].(string)
	return v
}

func previewOf(mimeType string, data []byte) string {
	if !strings.HasPrefix(mimeType, "image/") || len(data) == 0 || len(data) > 8<<20 {
		return ""
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func jsonMarshal(v any) ([]byte, error) {
	return marshalJSON(v)
}
