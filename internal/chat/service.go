package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

const (
	portControl = 100
	portText    = 101
	portLegacy  = 1

	codeHearMeow      = "hear-meow"
	codePeerChanged   = "peer-changed"
	codeRoomRestarted = "room-restarted"
	codeBadFrame      = "bad-frame"

	bodyHearMeow      = "they're hear meow"
	bodyPeerChanged   = "Peer changed"
	bodyRoomRestarted = "Room restarted. Send the new address."
	bodyBadFrame      = "Could not read a message."

	errBadAddr     = "Paste a Tailcat address that starts with tc."
	errUnreachable = "Could not reach peer. Check the address and that they are online."
)

type StartOpts struct {
	PrivateKeyJSON string
	Region         string
	DERPMapURL     string
	KeyName        string
}

type Message struct {
	ID        string `json:"id"`
	Direction string `json:"direction"`
	Type      string `json:"type"`
	Code      string `json:"code,omitempty"`
	Body      string `json:"body,omitempty"`
	At        string `json:"at"`
	Name      string `json:"name,omitempty"`
	Mime      string `json:"mime,omitempty"`
	Size      int64  `json:"size,omitempty"`
	Path      string `json:"path,omitempty"`
	FileID    string `json:"fileId,omitempty"`
	Burn      bool   `json:"burn,omitempty"`
	TTLSec    int    `json:"ttlSec,omitempty"`
	Preview   string `json:"preview,omitempty"`
	Duration  int    `json:"duration,omitempty"`
	Audio     string `json:"audio,omitempty"`
}

type Service struct {
	ad             adapter.ChatAdapter
	mu             sync.Mutex
	sess           *session.Session
	room           adapter.Room
	cancel         context.CancelFunc
	peer           string
	peerCaps       []string
	messages       []Message
	ui             chan adapter.Event
	opening        bool
	dataDir        string
	sending        bool
	queued         *fileJob
	failed         map[string]*fileJob
	transfers      []Transfer
	offsetWait     map[string]chan int64
	offsetWaitFor  time.Duration
	sendMu         sync.Mutex
	transferCancel context.CancelFunc
	roomCtx        context.Context
}

func New(ad adapter.ChatAdapter) *Service {
	return &Service{ad: ad, ui: make(chan adapter.Event, 64)}
}

func (s *Service) Events() <-chan adapter.Event { return s.ui }

func (s *Service) Peer() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.peer
}

func (s *Service) Messages() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Message, len(s.messages))
	copy(out, s.messages)
	return out
}

func (s *Service) Session() (session.Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sess == nil {
		return session.Session{}, false
	}
	return *s.sess, true
}

func (s *Service) Start(opts StartOpts) (session.Session, error) {
	s.mu.Lock()
	if s.room != nil && s.sess != nil && (s.sess.Status == session.StatusStarting || s.sess.Status == session.StatusRunning) {
		cur := *s.sess
		s.mu.Unlock()
		return cur, nil
	}
	if s.opening {
		s.mu.Unlock()
		return session.Session{}, fmt.Errorf("room is starting")
	}
	s.opening = true
	s.mu.Unlock()
	sess, err := s.open(opts, false)
	s.mu.Lock()
	s.opening = false
	s.mu.Unlock()
	return sess, err
}

func (s *Service) Restart(opts StartOpts) (session.Session, error) {
	s.shutdown(true)
	return s.open(opts, true)
}

func (s *Service) Stop() error {
	s.mu.Lock()
	dir := s.dataDir
	s.mu.Unlock()
	s.shutdown(true)
	_ = sweepChatDir(dir, partialDirName)
	return nil
}

func (s *Service) shutdown(markStopped bool) {
	s.mu.Lock()
	room := s.room
	cancel := s.cancel
	sess := s.sess
	s.room = nil
	s.cancel = nil
	s.roomCtx = nil
	s.peer = ""
	s.peerCaps = nil
	s.sending = false
	s.queued = nil
	if s.transferCancel != nil {
		s.transferCancel()
		s.transferCancel = nil
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if room != nil {
		_ = room.Close()
	}
	if markStopped && sess != nil && sess.Status != session.StatusStopped {
		_ = sess.Transition(session.StatusStopped)
	}
}

func (s *Service) open(opts StartOpts, restarted bool) (session.Session, error) {
	s.mu.Lock()
	if s.sess != nil && s.sess.Status != session.StatusStopped {
		_ = s.sess.Transition(session.StatusStopped)
	}
	sess := session.New(session.KindChat)
	s.sess = sess
	s.peer = ""
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.roomCtx = ctx
	var restartedMsg *Message
	if restarted {
		msg := newMessage("system", "system", codeRoomRestarted, bodyRoomRestarted)
		s.messages = append(s.messages, msg)
		restartedMsg = &msg
	}
	s.mu.Unlock()

	room, err := s.ad.StartRoom(ctx, adapter.RoomOpts{
		SessionID:      sess.ID,
		PrivateKeyJSON: opts.PrivateKeyJSON,
		Region:         opts.Region,
		DERPMapURL:     opts.DERPMapURL,
	})
	if err != nil {
		cancel()
		s.mu.Lock()
		sess.Err = err.Error()
		_ = sess.Transition(session.StatusError)
		s.room = nil
		s.mu.Unlock()
		return *sess, err
	}
	s.mu.Lock()
	s.room = room
	s.mu.Unlock()
	if restartedMsg != nil {
		s.emitMessage(sess.ID, *restartedMsg)
		s.emit(adapter.Event{SessionID: sess.ID, Kind: "peer", Data: `{"address":""}`})
	}
	go s.readLoop(room, sess.ID)
	return *sess, nil
}

func (s *Service) Connect(addr string) error {
	addr = strings.TrimSpace(addr)
	if !strings.HasPrefix(addr, "tc") {
		return fmt.Errorf("%s", errBadAddr)
	}
	s.mu.Lock()
	if s.room == nil || s.sess == nil || s.sess.Address == "" {
		s.mu.Unlock()
		return fmt.Errorf("room is not listening")
	}
	var changed *Message
	if s.peer != "" && s.peer != addr {
		msg := newMessage("system", "system", codePeerChanged, bodyPeerChanged)
		s.messages = append(s.messages, msg)
		changed = &msg
	}
	if s.peer != addr {
		s.peerCaps = nil
	}
	s.peer = addr
	local := s.sess.Address
	room := s.room
	sid := s.sess.ID
	s.mu.Unlock()
	if changed != nil {
		s.emitMessage(sid, *changed)
	}
	if err := room.SetPeer(addr); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	frame, err := Pack(map[string]any{"type": "hello", "replyTo": local, "caps": []string{"burn", "resume"}}, nil)
	if err != nil {
		return err
	}
	if err := s.dial(context.Background(), room, portControl, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	s.emitPeer(sid, addr, nil)
	return nil
}

func (s *Service) SendText(body string) error {
	return s.SendTextBurn(body, false, 0)
}

func (s *Service) readLoop(room adapter.Room, sessionID string) {
	for ev := range room.Events() {
		switch ev.Kind {
		case adapter.ChatEventReady:
			s.mu.Lock()
			if s.room == room && s.sess != nil && s.sess.ID == sessionID {
				s.sess.Address = ev.Address
				if s.sess.Status == session.StatusStarting {
					_ = s.sess.Transition(session.StatusRunning)
				}
			}
			s.mu.Unlock()
			body, _ := json.Marshal(map[string]string{"address": ev.Address})
			s.emit(adapter.Event{SessionID: sessionID, Kind: "room-ready", Address: ev.Address, Data: string(body)})
		case adapter.ChatEventInbound:
			s.onInbound(sessionID, ev)
		}
	}
}

func (s *Service) onInbound(sessionID string, ev adapter.ChatEvent) {
	if ev.Port == portLegacy {
		s.emit(adapter.Event{SessionID: sessionID, Kind: adapter.EventData, Data: "ignored port 1 stream"})
		return
	}
	meta, payload, err := Unpack(ev.Data)
	if err != nil {
		s.addSystem(sessionID, codeBadFrame, bodyBadFrame)
		return
	}
	typ, _ := meta["type"].(string)
	switch typ {
	case "hello":
		s.onHello(sessionID, meta)
	case "text":
		burn, ttl := readBurn(meta)
		s.addText(sessionID, "in", string(payload), burn, ttl)
	case "file":
		s.onWholeFile(sessionID, meta, payload)
	case "file-begin":
		s.onFileBegin(meta)
	case "file-chunk":
		s.onFileChunk(sessionID, meta, payload)
	case "file-offset":
		s.deliverOffset(stringField(meta, "id"), asInt(meta["offset"]))
	case "voice":
		s.onVoice(sessionID, meta, payload)
	case "rtc-offer", "rtc-answer", "rtc-hangup":
		s.emitControl(sessionID, ev.Data)
	default:
		return
	}
}

func (s *Service) onHello(sessionID string, meta map[string]any) {
	replyTo, _ := meta["replyTo"].(string)
	if !strings.HasPrefix(replyTo, "tc") {
		return
	}
	caps := capsOf(meta)
	s.mu.Lock()
	if replyTo == s.peer {
		s.peerCaps = caps
		s.mu.Unlock()
		s.emitPeer(sessionID, replyTo, caps)
		return
	}
	room := s.room
	var changed *Message
	if s.peer != "" {
		msg := newMessage("system", "system", codePeerChanged, bodyPeerChanged)
		s.messages = append(s.messages, msg)
		changed = &msg
	}
	s.peer = replyTo
	s.peerCaps = caps
	hear := newMessage("system", "system", codeHearMeow, bodyHearMeow)
	s.messages = append(s.messages, hear)
	s.mu.Unlock()
	if room != nil {
		_ = room.SetPeer(replyTo)
	}
	if changed != nil {
		s.emitMessage(sessionID, *changed)
	}
	s.emitMessage(sessionID, hear)
	s.emitPeer(sessionID, replyTo, capsOf(meta))
}

func (s *Service) addText(sessionID, direction, body string, burn bool, ttl int) {
	msg := newMessage(direction, "text", "", body)
	if burn {
		msg.Burn = true
		msg.TTLSec = clampTTL(ttl)
	}
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}

func (s *Service) addSystem(sessionID, code, body string) {
	msg := newMessage("system", "system", code, body)
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}

func (s *Service) emitPeer(sessionID, addr string, caps []string) {
	payload := map[string]any{"address": addr}
	if len(caps) > 0 {
		payload["caps"] = caps
	}
	body, _ := json.Marshal(payload)
	s.emit(adapter.Event{SessionID: sessionID, Kind: "peer", Data: string(body)})
}

func (s *Service) emit(ev adapter.Event) {
	select {
	case s.ui <- ev:
	default:
	}
}

func (s *Service) emitMessage(sessionID string, msg Message) {
	body, _ := json.Marshal(msg)
	s.emit(adapter.Event{SessionID: sessionID, Kind: "message", Data: string(body)})
}

func newMessage(direction, typ, code, body string) Message {
	return Message{
		ID:        newMessageID(),
		Direction: direction,
		Type:      typ,
		Code:      code,
		Body:      body,
		At:        time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func newMessageID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func capsOf(meta map[string]any) []string {
	raw, ok := meta["caps"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if str, ok := item.(string); ok {
			out = append(out, str)
		}
	}
	return out
}
