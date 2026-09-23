package adapter

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

func (f *Fake) GeneratePrivateKeyJSON() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return `{"fake":"` + hex.EncodeToString(b) + `"}`, nil
}

func fakeRoomAddress(sessionID, keyJSON string) string {
	if keyJSON == "" {
		return "tc:fake-room-" + sessionID
	}
	sum := sha256.Sum256([]byte(keyJSON))
	return "tc:fake-room-key-" + hex.EncodeToString(sum[:6])
}

func packFrame(meta map[string]any, payload []byte) ([]byte, error) {
	copied := make(map[string]any, len(meta)+1)
	for k, v := range meta {
		copied[k] = v
	}
	copied["v"] = 1
	body, err := json.Marshal(copied)
	if err != nil {
		return nil, err
	}
	frame := make([]byte, 8+len(body)+len(payload))
	copy(frame[:4], []byte("TCH1"))
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(body)))
	copy(frame[8:], body)
	copy(frame[8+len(body):], payload)
	return frame, nil
}

type fakeRoom struct {
	owner  *Fake
	id     string
	addr   string
	peer   string
	events chan ChatEvent
	once   sync.Once
}

func (f *Fake) StartRoom(ctx context.Context, opts RoomOpts) (Room, error) {
	if opts.SessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	fr := &fakeRoom{
		owner:  f,
		id:     opts.SessionID,
		addr:   fakeRoomAddress(opts.SessionID, opts.PrivateKeyJSON),
		events: make(chan ChatEvent, 16),
	}
	f.mu.Lock()
	if f.chatRooms == nil {
		f.chatRooms = map[string]*fakeRoom{}
	}
	f.chatRooms[fr.addr] = fr
	f.mu.Unlock()
	fr.events <- ChatEvent{SessionID: fr.id, Kind: ChatEventReady, Address: fr.addr}
	go func() {
		<-ctx.Done()
		_ = fr.Close()
	}()
	return fr, nil
}

func (r *fakeRoom) SessionID() string { return r.id }
func (r *fakeRoom) Address() string   { return r.addr }
func (r *fakeRoom) Events() <-chan ChatEvent {
	return r.events
}

func (r *fakeRoom) SetPeer(addr string) error {
	r.owner.mu.Lock()
	defer r.owner.mu.Unlock()
	if r.events == nil {
		return fmt.Errorf("room closed")
	}
	r.peer = addr
	return nil
}

func (r *fakeRoom) SendEnvelope(ctx context.Context, port uint16, frame []byte) error {
	r.owner.mu.Lock()
	peer := r.peer
	closed := r.events == nil
	r.owner.mu.Unlock()
	if closed {
		return fmt.Errorf("room closed")
	}
	if peer == "" {
		return fmt.Errorf("no peer")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	r.owner.record(peer, port, frame)
	switch peer {
	case "tc:fake-echo":
		if port == 101 {
			reply, err := packFrame(map[string]any{"type": "text"}, []byte("echo"))
			if err != nil {
				return err
			}
			return r.owner.deliver(r.addr, 101, reply)
		}
		return nil
	case "tc:fake-official":
		return nil
	case "tc:fake-box":
		return r.owner.replyHello(r.addr, frame, "tc:fake-box", []string{"burn", "resume"})
	case "tc:fake-resume":
		return r.owner.replyResume(r.addr, frame)
	default:
		return r.owner.deliver(peer, port, frame)
	}
}

func (f *Fake) record(peer string, port uint16, frame []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.captured = append(f.captured, CapturedFrame{Peer: peer, Port: port, Frame: append([]byte(nil), frame...)})
}

func (f *Fake) FramesTo(peer string) []CapturedFrame {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []CapturedFrame
	for _, frame := range f.captured {
		if frame.Peer == peer {
			out = append(out, frame)
		}
	}
	return out
}

func (f *Fake) replyHello(from string, frame []byte, replyTo string, caps []string) error {
	meta, _, err := unpackFrame(frame)
	if err != nil {
		return nil
	}
	if meta["type"] != "hello" {
		return nil
	}
	reply, err := packFrame(map[string]any{"type": "hello", "replyTo": replyTo, "caps": caps}, nil)
	if err != nil {
		return err
	}
	return f.deliver(from, 100, reply)
}

func (f *Fake) replyResume(from string, frame []byte) error {
	meta, payload, err := unpackFrame(frame)
	if err != nil {
		return err
	}
	switch meta["type"] {
	case "hello":
		return f.replyHello(from, frame, "tc:fake-resume", []string{"resume"})
	case "file-begin":
		id, _ := meta["id"].(string)
		f.mu.Lock()
		offset := len(f.resumeData[id])
		f.mu.Unlock()
		reply, err := packFrame(map[string]any{"type": "file-offset", "id": id, "offset": offset}, nil)
		if err != nil {
			return err
		}
		return f.deliver(from, 100, reply)
	case "file-chunk":
		id, _ := meta["id"].(string)
		off := int(asInt64(meta["offset"]))
		f.mu.Lock()
		if f.resumeData == nil {
			f.resumeData = map[string][]byte{}
		}
		if f.resumeDrops == nil {
			f.resumeDrops = map[string]int{}
		}
		cur := f.resumeData[id]
		if off <= len(cur) {
			start := len(cur) - off
			if start < len(payload) {
				cur = append(cur, payload[start:]...)
			}
			f.resumeData[id] = cur
		}
		drop := f.resumeDrops[id] == 0
		if drop {
			f.resumeDrops[id] = 1
		}
		f.mu.Unlock()
		if drop {
			return fmt.Errorf("chunk dropped")
		}
		return nil
	default:
		return nil
	}
}

func asInt64(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case int64:
		return n
	default:
		return 0
	}
}

func unpackFrame(frame []byte) (map[string]any, []byte, error) {
	if len(frame) < 8 || string(frame[:4]) != "TCH1" {
		return nil, nil, fmt.Errorf("bad magic")
	}
	n := binary.BigEndian.Uint32(frame[4:8])
	if uint64(n) > uint64(len(frame)-8) {
		return nil, nil, fmt.Errorf("length overrun")
	}
	var meta map[string]any
	if err := json.Unmarshal(frame[8:8+n], &meta); err != nil {
		return nil, nil, err
	}
	return meta, append([]byte(nil), frame[8+int(n):]...), nil
}

func (f *Fake) deliver(addr string, port uint16, frame []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	target := f.chatRooms[addr]
	if target == nil || target.events == nil {
		return fmt.Errorf("unreachable")
	}
	ev := ChatEvent{
		SessionID: target.id,
		Kind:      ChatEventInbound,
		Port:      port,
		Data:      append([]byte(nil), frame...),
	}
	select {
	case target.events <- ev:
		return nil
	default:
		return fmt.Errorf("inbound queue full")
	}
}

func (r *fakeRoom) Close() error {
	r.once.Do(func() {
		r.owner.mu.Lock()
		// A newer room may already be listening at this address. Deleting by
		// address alone unregisters that room and drops its session.
		if r.owner.chatRooms[r.addr] == r {
			delete(r.owner.chatRooms, r.addr)
		}
		ch := r.events
		r.events = nil
		r.owner.mu.Unlock()
		if ch != nil {
			close(ch)
		}
	})
	return nil
}

var _ ChatAdapter = (*Fake)(nil)
