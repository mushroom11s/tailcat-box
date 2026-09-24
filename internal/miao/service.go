package miao

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/chat"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

const (
	portMiao   = 102
	chunkSize  = 256 * 1024
	maxTTLDays = 3650
)

var (
	ErrEnded           = errors.New("The share has ended.")
	ErrUnreachable     = errors.New("Could not reach the host. They need to stay online.")
	ErrBusy            = errors.New("The share is busy. Try again in a moment.")
	ErrNeedDir         = errors.New("Choose a folder to save into.")
	ErrBadDays         = errors.New("Enter a number of days.")
	ErrBadCount        = errors.New("Enter a download count.")
	ErrUnknownReceive  = errors.New("Unknown download.")
	ErrReceiveStarted  = errors.New("That download has already started.")
	ErrPartialMismatch = errors.New("The partial file did not match. The download will start over.")
	ErrShareMissing    = errors.New("A shared file is missing, so that share was not restored.")
)

const (
	receiveConnecting  = "connecting"
	receiveQueued      = "queued"
	receiveDownloading = "downloading"
	receiveDone        = "done"
	receiveFailed      = "failed"
	receiveCancelled   = "cancelled"
	receiveInterrupted = "interrupted"
)

// transferHook is nil outside tests. A test can pause the host between the
// manifest and each chunk so a second pull is observable as queued.
var (
	transferHookMu sync.RWMutex
	transferHook   func(stage string)
)

func setTransferHook(fn func(string)) {
	transferHookMu.Lock()
	transferHook = fn
	transferHookMu.Unlock()
}

func currentTransferHook() func(string) {
	transferHookMu.RLock()
	defer transferHookMu.RUnlock()
	return transferHook
}

func callTransferHook(stage string) {
	if fn := currentTransferHook(); fn != nil {
		fn(stage)
	}
}

// Limits controls when a share closes. TTL 0 means no expiry. MaxDownloads 0 means unlimited.
type Limits struct {
	TTL          time.Duration
	TTLDays      int
	MaxDownloads int
}

// Snapshot is the host view returned to the UI.
type Snapshot struct {
	ID           string     `json:"id"`
	Address      string     `json:"address"`
	Token        string     `json:"token"`
	Payload      string     `json:"payload"`
	Files        []FileInfo `json:"files"`
	Total        int64      `json:"total"`
	Forever      bool       `json:"forever"`
	TTLDays      int        `json:"ttlDays"`
	ExpiresAt    string     `json:"expiresAt"`
	MaxDownloads int        `json:"maxDownloads"`
	Downloads    int        `json:"downloads"`
	Status       string     `json:"status"`
	EndReason    string     `json:"endReason"`
	CreatedAt    string     `json:"createdAt"`
}

// FileInfo is a display row. It does not include the storage path.
type FileInfo struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// SavedFile is one file written for a peer.
type SavedFile struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

// Receipt is the result of a successful download.
type Receipt struct {
	Files []SavedFile `json:"files"`
}

// ReceiveJob is one download started from the receive tab.
// Status is connecting, queued, downloading, done, failed, cancelled, or interrupted.
type ReceiveJob struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"`
	BytesDone  int64       `json:"bytesDone"`
	BytesTotal int64       `json:"bytesTotal"`
	Files      []FileInfo  `json:"files"`
	Saved      []SavedFile `json:"saved,omitempty"`
	Error      string      `json:"error,omitempty"`
	Dest       string      `json:"dest"`
	Payload    string      `json:"payload,omitempty"`
	Resumable  bool        `json:"resumable,omitempty"`
}

// Service hosts any number of shares at once and can also join someone else's share.
type Service struct {
	ad       adapter.ChatAdapter
	root     string
	mu       sync.Mutex
	hosts    map[string]*host
	order    []string
	receives map[string]*receiveRun
	events   chan adapter.Event
	notes    []string
}

func New(ad adapter.ChatAdapter, root string) *Service {
	s := &Service{ad: ad, root: root, hosts: map[string]*host{}, receives: map[string]*receiveRun{}, events: make(chan adapter.Event, 256)}
	if root != "" {
		_ = os.MkdirAll(root, 0o700)
		s.restore()
	}
	return s
}

func (s *Service) Events() <-chan adapter.Event { return s.events }

func (s *Service) RestoreNotes() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.notes...)
}

func (s *Service) Start(sources []Source, lim Limits, net adapter.NetworkOpts) (Snapshot, error) {
	if err := validateLimits(lim); err != nil {
		return Snapshot{}, err
	}
	if s.root == "" {
		return Snapshot{}, fmt.Errorf("share storage is not configured")
	}
	sess := session.New(session.KindMiao)
	pkg, err := Stage(filepath.Join(s.root, sess.ID), sources)
	if err != nil {
		return Snapshot{}, err
	}
	token, err := randomName()
	if err != nil {
		_ = pkg.Remove()
		return Snapshot{}, err
	}
	keyJSON, err := s.newRoomKey()
	if err != nil {
		_ = pkg.Remove()
		return Snapshot{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	room, err := s.ad.StartRoom(ctx, adapter.RoomOpts{
		SessionID:      sess.ID,
		PrivateKeyJSON: keyJSON,
		Region:         net.Region,
		DERPMapURL:     net.DERPMapURL,
	})
	if err != nil {
		cancel()
		_ = pkg.Remove()
		return Snapshot{}, err
	}
	h := &host{
		svc:       s,
		id:        sess.ID,
		token:     token,
		keyJSON:   keyJSON,
		dir:       pkg.Dir,
		files:     pkg.Files,
		total:     pkg.Total,
		lim:       lim,
		sess:      sess,
		room:      room,
		cancel:    cancel,
		ctx:       ctx,
		ready:     make(chan struct{}),
		forever:   lim.TTL <= 0,
		expires:   time.Time{},
		createdAt: sess.CreatedAt,
		region:    net.Region,
		derpURL:   net.DERPMapURL,
	}
	if lim.TTL > 0 {
		h.expires = time.Now().Add(lim.TTL)
	}
	s.mu.Lock()
	if s.hosts == nil {
		s.hosts = map[string]*host{}
	}
	s.hosts[h.id] = h
	s.order = append([]string{h.id}, s.order...)
	s.mu.Unlock()
	go h.readLoop()
	select {
	case <-h.ready:
	case <-time.After(20 * time.Second):
		h.end("error")
		return Snapshot{}, fmt.Errorf("share did not start listening")
	}
	h.mu.Lock()
	addr := h.address
	h.mu.Unlock()
	if addr == "" {
		h.end("error")
		return Snapshot{}, fmt.Errorf("share did not start listening")
	}
	payload, err := EncodeJoin(addr, token)
	if err != nil {
		h.end("error")
		return Snapshot{}, err
	}
	h.mu.Lock()
	h.payload = payload
	if err := h.writeStateLocked(); err != nil {
		h.mu.Unlock()
		h.end("error")
		return Snapshot{}, err
	}
	if h.lim.TTL > 0 {
		h.timer = time.AfterFunc(h.lim.TTL, func() { h.end("ttl") })
	}
	snap := h.snapshotLocked()
	h.mu.Unlock()
	h.publish(snap)
	return snap, nil
}

// List returns active shares, newest first.
func (s *Service) List() []Snapshot {
	s.mu.Lock()
	hosts := make([]*host, 0, len(s.order))
	for _, id := range s.order {
		if h := s.hosts[id]; h != nil {
			hosts = append(hosts, h)
		}
	}
	s.mu.Unlock()
	out := make([]Snapshot, 0, len(hosts))
	for _, h := range hosts {
		snap := h.snapshot()
		if snap.Status != "active" {
			continue
		}
		out = append(out, snap)
	}
	return out
}

func (s *Service) Sessions() []session.Session {
	s.mu.Lock()
	hosts := make([]*host, 0, len(s.order))
	for _, id := range s.order {
		if h := s.hosts[id]; h != nil {
			hosts = append(hosts, h)
		}
	}
	s.mu.Unlock()
	out := make([]session.Session, 0, len(hosts))
	for _, h := range hosts {
		h.mu.Lock()
		if h.sess != nil && !h.ended {
			out = append(out, *h.sess)
		}
		h.mu.Unlock()
	}
	return out
}

func (s *Service) End(id string) error {
	s.mu.Lock()
	h := s.hosts[id]
	s.mu.Unlock()
	if h == nil {
		return fmt.Errorf("Unknown share.")
	}
	h.end("manual")
	return nil
}

func (s *Service) Close() {
	s.mu.Lock()
	hosts := make([]*host, 0, len(s.hosts))
	for _, h := range s.hosts {
		hosts = append(hosts, h)
	}
	s.mu.Unlock()
	for _, h := range hosts {
		h.end("shutdown")
	}
}

// Join connects to the host in payload and writes the package into dest.
func (s *Service) Join(ctx context.Context, raw, dest string, net adapter.NetworkOpts) (Receipt, error) {
	return s.join(ctx, nil, 0, raw, dest, net)
}

// StartReceive validates the code and folder, then downloads in the background.
// The returned job is already connecting. Later progress is emitted as miao-receive events.
func (s *Service) StartReceive(parent context.Context, raw, dest string, net adapter.NetworkOpts) (ReceiveJob, error) {
	parsed, err := ParseJoin(raw)
	if err != nil {
		return ReceiveJob{}, err
	}
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return ReceiveJob{}, ErrNeedDir
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return ReceiveJob{}, err
	}
	if parent == nil {
		parent = context.Background()
	}
	if existing := s.matchReceive(parsed.Addr, parsed.Token, dest); existing != nil {
		existing.mu.Lock()
		status := existing.job.Status
		existing.mu.Unlock()
		if status == receiveConnecting || status == receiveQueued || status == receiveDownloading {
			return existing.snapshot(), nil
		}
		return s.restartReceive(parent, existing, raw, dest, net), nil
	}
	partial := loadPartial(dest, parsed.Addr, parsed.Token)
	if partial != nil && partial.ID == "" {
		partial = nil
	}
	id := session.New(session.KindMiao).ID
	files := []FileInfo{}
	var doneBytes int64
	var total int64
	if partial != nil {
		if partial.ID != "" {
			id = partial.ID
		} else {
			partial.ID = id
		}
		partial.Payload = strings.TrimSpace(raw)
		partial.Dest = dest
		job := partial.job()
		files = job.Files
		doneBytes = job.BytesDone
		total = job.BytesTotal
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	run := &receiveRun{
		gen:     1,
		cancel:  cancel,
		done:    make(chan struct{}),
		addr:    parsed.Addr,
		token:   parsed.Token,
		partial: partial,
		job: ReceiveJob{
			ID:         id,
			Status:     receiveConnecting,
			Dest:       dest,
			Files:      files,
			BytesDone:  doneBytes,
			BytesTotal: total,
			Payload:    strings.TrimSpace(raw),
			Resumable:  doneBytes > 0,
		},
	}
	s.mu.Lock()
	if s.receives == nil {
		s.receives = map[string]*receiveRun{}
	}
	s.receives[run.job.ID] = run
	s.mu.Unlock()
	snap := run.snapshot()
	s.publishReceive(snap, false)
	go s.runReceive(ctx, run, raw, dest, net)
	return snap, nil
}

func (s *Service) restartReceive(parent context.Context, run *receiveRun, raw, dest string, net adapter.NetworkOpts) ReceiveJob {
	run.mu.Lock()
	switch run.job.Status {
	case receiveConnecting, receiveQueued, receiveDownloading:
		snap := run.snapshotLocked()
		run.mu.Unlock()
		return snap
	}
	oldCancel := run.cancel
	oldDone := run.done
	run.gen++
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	run.cancel = cancel
	run.done = make(chan struct{})
	run.writing = false
	run.job.Status = receiveConnecting
	run.job.Error = ""
	run.job.Payload = strings.TrimSpace(raw)
	run.job.Dest = dest
	run.mu.Unlock()
	if oldCancel != nil {
		oldCancel()
	}
	if oldDone != nil {
		select {
		case <-oldDone:
		case <-time.After(20 * time.Second):
		}
	}
	run.mu.Lock()
	if run.partial != nil {
		run.job.BytesDone = run.partial.bytesDone()
		run.job.BytesTotal = run.partial.bytesTotal()
		run.job.Resumable = run.job.BytesDone > 0 || len(run.partial.Files) > 0
		run.job.Files = run.partial.job().Files
	}
	snap := run.snapshotLocked()
	run.mu.Unlock()
	s.publishReceive(snap, false)
	go s.runReceive(ctx, run, raw, dest, net)
	return snap
}

func (s *Service) runReceive(ctx context.Context, run *receiveRun, raw, dest string, net adapter.NetworkOpts) {
	run.mu.Lock()
	gen := run.gen
	cancel := run.cancel
	done := run.done
	run.mu.Unlock()
	defer func() {
		if cancel != nil {
			cancel()
		}
		if done != nil {
			close(done)
		}
	}()
	receipt, err := s.join(ctx, run, gen, raw, dest, net)
	run.mu.Lock()
	stale := run.gen != gen
	run.mu.Unlock()
	if stale {
		return
	}
	if err == nil {
		s.finishReceive(run, gen, receiveDone, "", receipt.Files)
		return
	}
	if errors.Is(err, context.Canceled) {
		if s.keptPartial(run) {
			s.finishReceive(run, gen, receiveInterrupted, "", nil)
		} else {
			s.finishReceive(run, gen, receiveCancelled, "", nil)
			s.dropPartial(run)
		}
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		err = ErrUnreachable
	}
	if s.keptPartial(run) {
		s.finishReceive(run, gen, receiveInterrupted, err.Error(), nil)
		return
	}
	s.finishReceive(run, gen, receiveFailed, err.Error(), nil)
}

func (s *Service) keptPartial(run *receiveRun) bool {
	run.mu.Lock()
	defer run.mu.Unlock()
	if run.partial != nil {
		return run.partial.bytesDone() > 0
	}
	return run.job.BytesDone > 0
}

func (s *Service) dropPartial(run *receiveRun) {
	run.mu.Lock()
	partial := run.partial
	run.partial = nil
	run.job.Resumable = false
	run.mu.Unlock()
	if partial != nil {
		partial.remove(s.root)
	}
}

func (s *Service) matchReceive(addr, token, dest string) *receiveRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, run := range s.receives {
		run.mu.Lock()
		same := run.addr == addr && run.token == token && run.job.Dest == dest
		status := run.job.Status
		run.mu.Unlock()
		if !same || status == receiveDone {
			continue
		}
		return run
	}
	return nil
}

// ListReceives returns in-memory jobs plus partial downloads saved across restarts.
func (s *Service) ListReceives() []ReceiveJob {
	seen := map[string]bool{}
	var out []ReceiveJob
	s.mu.Lock()
	runs := make([]*receiveRun, 0, len(s.receives))
	for _, run := range s.receives {
		runs = append(runs, run)
	}
	s.mu.Unlock()
	for _, run := range runs {
		snap := run.snapshot()
		if snap.Status == receiveDone || snap.Status == receiveCancelled || snap.ID == "" {
			continue
		}
		out = append(out, snap)
		seen[snap.ID] = true
	}
	for _, st := range loadIncoming(s.root) {
		job := st.job()
		if job.ID == "" || seen[job.ID] {
			continue
		}
		out = append(out, job)
		seen[job.ID] = true
	}
	if out == nil {
		return []ReceiveJob{}
	}
	return out
}

// DiscardReceive deletes a finished or interrupted download and its partial files.
func (s *Service) DiscardReceive(id string) error {
	s.mu.Lock()
	run := s.receives[id]
	s.mu.Unlock()
	if run != nil {
		run.mu.Lock()
		status := run.job.Status
		partial := run.partial
		addr, token, dest := run.addr, run.token, run.job.Dest
		run.mu.Unlock()
		if status == receiveConnecting || status == receiveQueued || status == receiveDownloading {
			return ErrReceiveStarted
		}
		if partial == nil {
			partial = loadPartial(dest, addr, token)
		}
		if partial != nil {
			partial.remove(s.root)
		}
		s.mu.Lock()
		delete(s.receives, id)
		s.mu.Unlock()
		return nil
	}
	for _, st := range loadIncoming(s.root) {
		if st.ID != id {
			continue
		}
		st.remove(s.root)
		return nil
	}
	return ErrUnknownReceive
}

// CancelReceive stops an in-progress download. A finished job is left as it is.
func (s *Service) CancelReceive(id string) error {
	s.mu.Lock()
	run := s.receives[id]
	s.mu.Unlock()
	if run == nil {
		return ErrUnknownReceive
	}
	run.mu.Lock()
	cancel := run.cancel
	done := receiveTerminal(run.job.Status)
	run.mu.Unlock()
	if done || cancel == nil {
		return nil
	}
	cancel()
	return nil
}

// SetReceiveDest changes the folder for a job that has not started writing files.
func (s *Service) SetReceiveDest(id, dest string) error {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return ErrNeedDir
	}
	s.mu.Lock()
	run := s.receives[id]
	s.mu.Unlock()
	if run == nil {
		return ErrUnknownReceive
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return err
	}
	run.mu.Lock()
	if receiveTerminal(run.job.Status) || run.writing || (run.partial != nil && run.partial.bytesDone() > 0) {
		run.mu.Unlock()
		return ErrReceiveStarted
	}
	run.job.Dest = dest
	snap := run.snapshotLocked()
	run.mu.Unlock()
	s.publishReceive(snap, false)
	return nil
}

type receiveRun struct {
	mu      sync.Mutex
	job     ReceiveJob
	gen     int
	cancel  context.CancelFunc
	done    chan struct{}
	writing bool
	addr    string
	token   string
	partial *partialState
}

func (r *receiveRun) snapshot() ReceiveJob {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked()
}

func (r *receiveRun) snapshotLocked() ReceiveJob {
	job := r.job
	if job.Files == nil {
		job.Files = []FileInfo{}
	} else {
		job.Files = append([]FileInfo(nil), r.job.Files...)
	}
	if r.job.Saved != nil {
		job.Saved = append([]SavedFile(nil), r.job.Saved...)
	}
	return job
}

func receiveTerminal(status string) bool {
	return status == receiveDone || status == receiveFailed || status == receiveCancelled
}

func (s *Service) noteReceive(run *receiveRun, gen int, upd receiveUpdate) {
	run.mu.Lock()
	if run.gen != gen || receiveTerminal(run.job.Status) || run.job.Status == receiveInterrupted {
		run.mu.Unlock()
		return
	}
	if upd.status != "" {
		run.job.Status = upd.status
	}
	if upd.files != nil {
		run.job.Files = upd.files
	}
	if upd.bytesTotal > 0 {
		run.job.BytesTotal = upd.bytesTotal
	}
	run.job.BytesDone = upd.bytesDone
	if upd.status == receiveDownloading {
		run.writing = true
	}
	snap := run.snapshotLocked()
	run.mu.Unlock()
	s.publishReceive(snap, false)
}

func (s *Service) finishReceive(run *receiveRun, gen int, status, errText string, saved []SavedFile) {
	run.mu.Lock()
	if run.gen != gen || receiveTerminal(run.job.Status) {
		run.mu.Unlock()
		return
	}
	run.job.Status = status
	run.job.Error = errText
	var drop *partialState
	if status == receiveDone {
		run.job.Saved = saved
		if len(run.job.Files) == 0 {
			files := make([]FileInfo, 0, len(saved))
			for _, file := range saved {
				files = append(files, FileInfo{Name: file.Name, Size: file.Size, SHA256: file.SHA256})
			}
			run.job.Files = files
		}
		if run.job.BytesTotal <= 0 {
			var total int64
			for _, file := range saved {
				total += file.Size
			}
			run.job.BytesTotal = total
		}
		run.job.BytesDone = run.job.BytesTotal
		run.job.Resumable = false
		drop = run.partial
		run.partial = nil
	}
	if status == receiveCancelled {
		run.job.Resumable = false
	}
	if (status == receiveInterrupted || status == receiveFailed) && run.partial != nil {
		run.job.BytesDone = run.partial.bytesDone()
		if total := run.partial.bytesTotal(); total > 0 {
			run.job.BytesTotal = total
		}
		if files := run.partial.job().Files; len(files) > 0 {
			run.job.Files = files
		}
		run.job.Resumable = run.partial.bytesDone() > 0 || len(run.partial.Files) > 0
	}
	snap := run.snapshotLocked()
	run.mu.Unlock()
	if drop != nil {
		drop.remove(s.root)
	}
	s.publishReceive(snap, true)
}

func (s *Service) publishReceive(job ReceiveJob, terminal bool) {
	if job.Files == nil {
		job.Files = []FileInfo{}
	}
	body, err := json.Marshal(job)
	if err != nil {
		return
	}
	ev := adapter.Event{SessionID: job.ID, Kind: "miao-receive", Data: string(body)}
	if !terminal {
		s.emit(ev)
		return
	}
	select {
	case s.events <- ev:
	case <-time.After(2 * time.Second):
	}
}

func (s *Service) join(ctx context.Context, run *receiveRun, gen int, raw, dest string, net adapter.NetworkOpts) (Receipt, error) {
	payload, err := ParseJoin(raw)
	if err != nil {
		return Receipt{}, err
	}
	dest = strings.TrimSpace(dest)
	if run != nil {
		run.mu.Lock()
		if chosen := strings.TrimSpace(run.job.Dest); chosen != "" {
			dest = chosen
		}
		run.mu.Unlock()
	}
	if dest == "" {
		return Receipt{}, ErrNeedDir
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return Receipt{}, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var progress func(receiveUpdate)
	var destFn func() string
	if run != nil {
		progress = func(upd receiveUpdate) { s.noteReceive(run, gen, upd) }
		destFn = func() string {
			run.mu.Lock()
			defer run.mu.Unlock()
			if chosen := strings.TrimSpace(run.job.Dest); chosen != "" {
				return chosen
			}
			return dest
		}
	}
	sess := session.New(session.KindMiao)
	roomCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	room, err := s.ad.StartRoom(roomCtx, adapter.RoomOpts{
		SessionID:  sess.ID,
		Region:     net.Region,
		DERPMapURL: net.DERPMapURL,
	})
	if err != nil {
		return Receipt{}, err
	}
	defer room.Close()

	ready := make(chan string, 1)
	done := make(chan joinResult, 1)
	var partial *partialState
	if run != nil {
		run.mu.Lock()
		partial = run.partial
		if partial == nil {
			partial = &partialState{
				V:       partialVersion,
				ID:      run.job.ID,
				Addr:    payload.Addr,
				Token:   payload.Token,
				Payload: strings.TrimSpace(raw),
				Dest:    dest,
			}
			run.partial = partial
		}
		run.mu.Unlock()
	}
	go receivePackage(ctx, room, dest, destFn, ready, done, progress, partial, s.root)

	var local string
	select {
	case local = <-ready:
	case <-ctx.Done():
		_ = room.Close()
		return waitJoin(ctx, done)
	case <-time.After(20 * time.Second):
		_ = room.Close()
		return waitJoin(ctx, done)
	}
	if err := room.SetPeer(payload.Addr); err != nil {
		_ = room.Close()
		return waitJoin(ctx, done)
	}
	pull := map[string]any{"type": "miao-pull", "token": payload.Token, "replyTo": local}
	if partial != nil {
		if offsets := partial.offsets(); len(offsets) > 0 {
			resume := make([]map[string]any, 0, len(offsets))
			for id, off := range offsets {
				resume = append(resume, map[string]any{"id": id, "offset": off})
			}
			pull["resume"] = resume
		}
	}
	frame, err := chat.Pack(pull, nil)
	if err != nil {
		_ = room.Close()
		_, _ = waitJoin(ctx, done)
		return Receipt{}, err
	}
	if err := dial(ctx, room, frame); err != nil {
		_ = room.Close()
		return waitJoin(ctx, done)
	}
	select {
	case res := <-done:
		if res.err != nil {
			return Receipt{}, res.err
		}
		ack, packErr := chat.Pack(map[string]any{"type": "miao-ack"}, nil)
		if packErr == nil {
			_ = dial(ctx, room, ack)
		}
		return Receipt{Files: res.files}, nil
	case <-ctx.Done():
		_ = room.Close()
		return waitJoin(ctx, done)
	}
}

func waitJoin(ctx context.Context, done <-chan joinResult) (Receipt, error) {
	res := <-done
	if res.err == nil {
		return Receipt{Files: res.files}, nil
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return Receipt{}, context.Canceled
	}
	return Receipt{}, res.err
}

func validateLimits(lim Limits) error {
	if lim.TTL < 0 || lim.TTLDays < 0 || lim.MaxDownloads < 0 || lim.TTLDays > maxTTLDays {
		return ErrBadDays
	}
	return nil
}

type host struct {
	svc       *Service
	id        string
	token     string
	payload   string
	address   string
	dir       string
	files     []StagedFile
	total     int64
	lim       Limits
	forever   bool
	expires   time.Time
	downloads int
	keyJSON   string
	createdAt time.Time
	region    string
	derpURL   string
	sess      *session.Session
	room      adapter.Room
	cancel    context.CancelFunc
	ctx       context.Context
	timer     *time.Timer
	ready     chan struct{}
	readyOnce sync.Once
	mu        sync.Mutex
	sendMu    sync.Mutex
	ended     bool
	reason    string
	sending   bool
	queued    bool
	qToken    string
	qReply    string
	qResume   map[string]int64
}

func (h *host) readLoop() {
	for ev := range h.room.Events() {
		switch ev.Kind {
		case adapter.ChatEventReady:
			h.mu.Lock()
			h.address = ev.Address
			if h.sess != nil && h.sess.Status == session.StatusStarting {
				h.sess.Address = ev.Address
				_ = h.sess.Transition(session.StatusRunning)
			}
			h.mu.Unlock()
			h.readyOnce.Do(func() { close(h.ready) })
		case adapter.ChatEventInbound:
			if ev.Port != portMiao {
				continue
			}
			meta, _, err := chat.Unpack(ev.Data)
			if err != nil {
				continue
			}
			if meta["type"] != "miao-pull" {
				continue
			}
			token, _ := meta["token"].(string)
			reply, _ := meta["replyTo"].(string)
			go h.handlePull(token, reply, parseResume(meta["resume"]))
		}
	}
}

func (h *host) handlePull(token, reply string, resume map[string]int64) {
	h.mu.Lock()
	if h.ended {
		h.mu.Unlock()
		return
	}
	if h.sending {
		match := subtle.ConstantTimeCompare([]byte(token), []byte(h.token)) == 1
		if !match {
			h.mu.Unlock()
			h.sendDeny(reply, "bad-token")
			return
		}
		h.queued = true
		h.qToken = token
		h.qReply = reply
		h.qResume = cloneOffsets(resume)
		h.mu.Unlock()
		h.notifyQueued(reply)
		return
	}
	h.sending = true
	room := h.room
	match := subtle.ConstantTimeCompare([]byte(token), []byte(h.token)) == 1
	files := append([]StagedFile(nil), h.files...)
	h.mu.Unlock()

	defer h.finishSend()
	if room == nil || !strings.HasPrefix(reply, "tc") {
		return
	}
	if !match {
		h.sendDeny(reply, "bad-token")
		return
	}
	if err := h.sendPackage(reply, files, resume); err != nil {
		return
	}
	h.mu.Lock()
	if !h.ended {
		h.downloads++
		_ = h.writeStateLocked()
	}
	downloads := h.downloads
	max := h.lim.MaxDownloads
	ended := h.ended
	snap := h.snapshotLocked()
	h.mu.Unlock()
	if !ended {
		h.publish(snap)
	}
	if !ended && max > 0 && downloads >= max {
		h.end("count")
	}
}

func (h *host) finishSend() {
	h.mu.Lock()
	h.sending = false
	queued := h.queued
	token, reply := h.qToken, h.qReply
	resume := h.qResume
	h.queued = false
	h.qResume = nil
	ended := h.ended
	h.mu.Unlock()
	if queued && !ended {
		go h.handlePull(token, reply, resume)
	}
}

func (h *host) notifyQueued(reply string) {
	if !strings.HasPrefix(reply, "tc") {
		return
	}
	frame, err := chat.Pack(map[string]any{"type": "miao-queued"}, nil)
	if err != nil {
		return
	}
	h.mu.Lock()
	ctx := h.ctx
	h.mu.Unlock()
	_ = h.sendFrame(ctx, reply, frame)
}

func (h *host) sendDeny(reply, reason string) {
	if !strings.HasPrefix(reply, "tc") {
		return
	}
	frame, err := chat.Pack(map[string]any{"type": "miao-deny", "reason": reason}, nil)
	if err != nil {
		return
	}
	h.mu.Lock()
	ctx := h.ctx
	h.mu.Unlock()
	_ = h.sendFrame(ctx, reply, frame)
}

func (h *host) sendFrame(ctx context.Context, reply string, frame []byte) error {
	h.sendMu.Lock()
	defer h.sendMu.Unlock()
	if h.room == nil {
		return fmt.Errorf("room closed")
	}
	if err := h.room.SetPeer(reply); err != nil {
		return err
	}
	return dial(ctx, h.room, frame)
}

func (h *host) sendPackage(reply string, files []StagedFile, resume map[string]int64) error {
	defer func() {
		callTransferHook("sent")
	}()
	metaFiles := make([]map[string]any, 0, len(files))
	for _, file := range files {
		metaFiles = append(metaFiles, map[string]any{
			"id":     file.StorageName,
			"name":   file.Name,
			"size":   file.Size,
			"sha256": file.SHA256,
		})
	}
	frame, err := chat.Pack(map[string]any{"type": "miao-manifest", "files": metaFiles}, nil)
	if err != nil {
		return err
	}
	callTransferHook("manifest")
	if err := h.sendFrame(h.ctx, reply, frame); err != nil {
		return err
	}
	for _, file := range files {
		start := int64(0)
		if resume != nil {
			if off, ok := resume[file.StorageName]; ok {
				start = off
			}
		}
		if start < 0 || start > file.Size {
			start = 0
		}
		if err := sendFile(h.ctx, func(frame []byte) error {
			return h.sendFrame(h.ctx, reply, frame)
		}, file, start); err != nil {
			return err
		}
	}
	done, err := chat.Pack(map[string]any{"type": "miao-done"}, nil)
	if err != nil {
		return err
	}
	return h.sendFrame(h.ctx, reply, done)
}

func (h *host) end(reason string) {
	h.mu.Lock()
	if h.ended {
		h.mu.Unlock()
		return
	}
	keep := reason == "shutdown" || reason == "unready"
	if keep {
		_ = h.writeStateLocked()
	}
	h.ended = true
	h.reason = reason
	if h.sess != nil && h.sess.Status != session.StatusStopped && h.sess.Status != session.StatusError {
		if reason == "error" && h.sess.Status == session.StatusStarting {
			h.sess.Err = reason
			_ = h.sess.Transition(session.StatusError)
		} else if h.sess.Status != session.StatusError {
			_ = h.sess.Transition(session.StatusStopped)
		}
	}
	snap := h.snapshotLocked()
	snap.Status = "ended"
	snap.EndReason = reason
	timer := h.timer
	cancel := h.cancel
	room := h.room
	dir := h.dir
	h.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
	if cancel != nil {
		cancel()
	}
	if room != nil {
		_ = room.Close()
	}
	if !keep {
		_ = os.RemoveAll(dir)
	}
	h.svc.detach(h)
	if !keep {
		h.publish(snap)
	}
	h.readyOnce.Do(func() { close(h.ready) })
}

func (h *host) snapshot() Snapshot {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked()
}

func (h *host) snapshotLocked() Snapshot {
	files := make([]FileInfo, 0, len(h.files))
	for _, file := range h.files {
		files = append(files, FileInfo{Name: file.Name, Size: file.Size, SHA256: file.SHA256})
	}
	status := "active"
	if h.ended {
		status = "ended"
	}
	expires := ""
	if !h.forever && !h.expires.IsZero() {
		expires = h.expires.UTC().Format(time.RFC3339)
	}
	addr := h.address
	if addr == "" && h.sess != nil {
		addr = h.sess.Address
	}
	created := ""
	if !h.createdAt.IsZero() {
		created = h.createdAt.UTC().Format(time.RFC3339)
	}
	return Snapshot{
		ID:           h.id,
		Address:      addr,
		Token:        h.token,
		Payload:      h.payload,
		Files:        files,
		Total:        h.total,
		Forever:      h.forever,
		TTLDays:      h.lim.TTLDays,
		ExpiresAt:    expires,
		MaxDownloads: h.lim.MaxDownloads,
		Downloads:    h.downloads,
		Status:       status,
		EndReason:    h.reason,
		CreatedAt:    created,
	}
}

func (h *host) publish(snap Snapshot) {
	body, err := json.Marshal(snap)
	if err != nil {
		return
	}
	h.svc.emit(adapter.Event{SessionID: h.id, Kind: "miao", Data: string(body)})
}

func (s *Service) detach(h *host) {
	s.mu.Lock()
	if s.hosts[h.id] == h {
		delete(s.hosts, h.id)
		next := make([]string, 0, len(s.order))
		for _, id := range s.order {
			if id != h.id {
				next = append(next, id)
			}
		}
		s.order = next
	}
	s.mu.Unlock()
}

func (s *Service) emit(ev adapter.Event) {
	select {
	case s.events <- ev:
	default:
	}
}

func sendFile(ctx context.Context, send func([]byte) error, file StagedFile, start int64) error {
	if start < 0 || start > file.Size {
		start = 0
	}
	if start == file.Size {
		return nil
	}
	in, err := os.Open(file.Path)
	if err != nil {
		return err
	}
	defer in.Close()
	if start > 0 {
		if _, err := in.Seek(start, io.SeekStart); err != nil {
			return err
		}
	}
	buf := make([]byte, chunkSize)
	offset := start
	for {
		if ctx != nil {
			if err := ctx.Err(); err != nil {
				return err
			}
		}
		n, err := in.Read(buf)
		if n > 0 {
			frame, packErr := chat.Pack(map[string]any{
				"type":   "miao-chunk",
				"id":     file.StorageName,
				"offset": offset,
			}, buf[:n])
			if packErr != nil {
				return packErr
			}
			if err := send(frame); err != nil {
				return err
			}
			offset += int64(n)
			callTransferHook("chunk")
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func dial(ctx context.Context, room adapter.Room, frame []byte) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	return room.SendEnvelope(cctx, portMiao, frame)
}

type joinResult struct {
	files []SavedFile
	err   error
}

type receiveUpdate struct {
	status     string
	files      []FileInfo
	bytesDone  int64
	bytesTotal int64
}

type incomingFile struct {
	id   string
	name string
	size int64
	sha  string
	path string
	got  int64
	file *os.File
}

func receivePackage(ctx context.Context, room adapter.Room, dest string, destFn func() string, ready chan<- string, done chan<- joinResult, progress func(receiveUpdate), partial *partialState, indexRoot string) {
	writers := map[string]*incomingFile{}
	var order []string
	var bytesDone int64
	var bytesTotal int64
	partialMode := partial != nil
	if partialMode {
		bytesDone = partial.bytesDone()
		bytesTotal = partial.bytesTotal()
	}
	persist := func() {
		if !partialMode || len(order) == 0 {
			return
		}
		files := make([]*incomingFile, 0, len(order))
		for _, id := range order {
			files = append(files, writers[id])
		}
		partial.remember(files)
		_ = partial.save(indexRoot)
	}
	closeFiles := func(syncFile bool) {
		for _, item := range writers {
			if item.file == nil {
				continue
			}
			if syncFile {
				_ = item.file.Sync()
			}
			_ = item.file.Close()
			item.file = nil
		}
	}
	fail := func(err error) {
		if partialMode {
			closeFiles(true)
			persist()
		} else {
			closeFiles(false)
			for _, item := range writers {
				if item.path != "" {
					_ = os.Remove(item.path)
					item.path = ""
				}
			}
		}
		done <- joinResult{err: err}
	}
	note := func(upd receiveUpdate) {
		if progress != nil {
			progress(upd)
		}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	for ev := range room.Events() {
		if ctx.Err() != nil {
			break
		}
		switch ev.Kind {
		case adapter.ChatEventReady:
			select {
			case ready <- ev.Address:
			default:
			}
		case adapter.ChatEventInbound:
			if ev.Port != portMiao {
				continue
			}
			meta, payload, err := chat.Unpack(ev.Data)
			if err != nil {
				continue
			}
			typ, _ := meta["type"].(string)
			switch typ {
			case "miao-deny":
				reason, _ := meta["reason"].(string)
				if reason == "bad-token" {
					fail(ErrBadCode)
				} else if reason == "busy" {
					fail(ErrBusy)
				} else {
					fail(ErrEnded)
				}
				return
			case "miao-queued":
				note(receiveUpdate{status: receiveQueued, bytesDone: bytesDone, bytesTotal: bytesTotal})
			case "miao-manifest":
				files, err := parseManifest(meta["files"])
				if err != nil {
					fail(err)
					return
				}
				folder := dest
				if destFn != nil {
					if chosen := strings.TrimSpace(destFn()); chosen != "" {
						folder = chosen
					}
				}
				if err := os.MkdirAll(folder, 0o700); err != nil {
					fail(err)
					return
				}
				infos := make([]FileInfo, 0, len(files))
				var total int64
				var resumed int64
				for _, file := range files {
					name, err := cleanDisplayName(file.name)
					if err != nil {
						fail(err)
						return
					}
					var path string
					var got int64
					var out *os.File
					if partialMode {
						partial.Dest = folder
						got, path = partial.prepare(file)
						out, err = os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
						if err != nil {
							fail(err)
							return
						}
						if got == 0 {
							if err := out.Truncate(0); err != nil {
								_ = out.Close()
								fail(err)
								return
							}
						}
					} else {
						path, err = uniquePath(folder, name)
						if err != nil {
							fail(err)
							return
						}
						out, err = os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
						if err != nil {
							fail(err)
							return
						}
					}
					item := &incomingFile{id: file.id, name: name, size: file.size, sha: file.sha, path: path, got: got, file: out}
					writers[file.id] = item
					order = append(order, file.id)
					infos = append(infos, FileInfo{Name: name, Size: file.size, SHA256: file.sha})
					total += file.size
					resumed += got
				}
				bytesTotal = total
				bytesDone = resumed
				if partialMode {
					persist()
				}
				note(receiveUpdate{status: receiveDownloading, files: infos, bytesDone: bytesDone, bytesTotal: bytesTotal})
			case "miao-chunk":
				id, _ := meta["id"].(string)
				item := writers[id]
				if item == nil || item.file == nil {
					fail(fmt.Errorf("unexpected chunk"))
					return
				}
				offset := asInt(meta["offset"])
				if partialMode && offset == 0 && item.got > 0 {
					bytesDone -= item.got
					if bytesDone < 0 {
						bytesDone = 0
					}
					item.got = 0
					if err := item.file.Truncate(0); err != nil {
						fail(err)
						return
					}
				}
				if partialMode && offset != item.got {
					bytesDone -= item.got
					if bytesDone < 0 {
						bytesDone = 0
					}
					item.got = 0
					_ = item.file.Truncate(0)
					persist()
					fail(ErrPartialMismatch)
					return
				}
				if _, err := item.file.WriteAt(payload, offset); err != nil {
					fail(err)
					return
				}
				end := offset + int64(len(payload))
				if end > item.got {
					item.got = end
				}
				bytesDone += int64(len(payload))
				if partialMode {
					_ = item.file.Sync()
					persist()
				}
				note(receiveUpdate{status: receiveDownloading, bytesDone: bytesDone, bytesTotal: bytesTotal})
			case "miao-done":
				closeFiles(partialMode)
				type checkedFile struct {
					item *incomingFile
					sum  string
					n    int64
				}
				checked := make([]checkedFile, 0, len(order))
				for _, id := range order {
					item := writers[id]
					if item.got != item.size {
						fail(fmt.Errorf("incomplete file %s", item.name))
						return
					}
					sum, n, err := hashFile(item.path)
					if err != nil {
						fail(err)
						return
					}
					if n != item.size || (item.sha != "" && !strings.EqualFold(sum, item.sha)) {
						if partialMode {
							_ = os.Remove(item.path)
							bytesDone -= item.got
							if bytesDone < 0 {
								bytesDone = 0
							}
							item.got = 0
							persist()
							done <- joinResult{err: ErrPartialMismatch}
							return
						}
						fail(fmt.Errorf("file check failed"))
						return
					}
					checked = append(checked, checkedFile{item: item, sum: sum, n: n})
				}
				folder := dest
				if destFn != nil {
					if chosen := strings.TrimSpace(destFn()); chosen != "" {
						folder = chosen
					}
				}
				saved := make([]SavedFile, 0, len(checked))
				for _, file := range checked {
					finalPath := file.item.path
					if partialMode {
						var err error
						finalPath, err = uniquePath(folder, file.item.name)
						if err != nil {
							fail(err)
							return
						}
						if err := os.Rename(file.item.path, finalPath); err != nil {
							fail(err)
							return
						}
					}
					saved = append(saved, SavedFile{Name: file.item.name, Size: file.n, Path: finalPath, SHA256: file.sum})
					file.item.path = ""
				}
				if partialMode {
					partial.remove(indexRoot)
				}
				done <- joinResult{files: saved}
				return
			}
		}
	}
	if ctx.Err() != nil {
		fail(ctx.Err())
		return
	}
	fail(ErrUnreachable)
}

type manifestItem struct {
	id   string
	name string
	size int64
	sha  string
}

func parseManifest(raw any) ([]manifestItem, error) {
	list, ok := raw.([]any)
	if !ok || len(list) == 0 {
		return nil, fmt.Errorf("empty package")
	}
	out := make([]manifestItem, 0, len(list))
	for _, entry := range list {
		obj, ok := entry.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("bad package")
		}
		id, _ := obj["id"].(string)
		name, _ := obj["name"].(string)
		sha, _ := obj["sha256"].(string)
		if id == "" || name == "" {
			return nil, fmt.Errorf("bad package")
		}
		out = append(out, manifestItem{id: id, name: name, size: asInt(obj["size"]), sha: sha})
	}
	return out, nil
}

func uniquePath(dir, name string) (string, error) {
	base := filepath.Join(dir, name)
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return base, nil
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; i < 1000; i++ {
		next := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(next); os.IsNotExist(err) {
			return next, nil
		}
	}
	return "", fmt.Errorf("could not name %s", name)
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

func asInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case int64:
		return n
	case json.Number:
		i, _ := n.Int64()
		return i
	default:
		return 0
	}
}
