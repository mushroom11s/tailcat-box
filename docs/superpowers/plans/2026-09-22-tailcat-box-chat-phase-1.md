# Tailcat Box Phase 1 — Nav, Room, Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shipped toolbox shell into a chat-first Tailcat Box that opens one room, exchanges raw `tc…` addresses, and sends text both ways with Tailcatchat and with another Box.

**Architecture:** React/Wails stays the shell. A new `internal/chat` service owns the single room, the peer, and the in-memory transcript, and it is the only place that packs or unpacks TCH1. `internal/adapter` grows a separate `ChatAdapter` (fake and real). The real adapter is the only package that imports `github.com/tailscale/tailcat`. The webview never dials Tailcat. Toolbox pages stay on disk and stay unmounted. Phase 1 hello objects omit `caps`.

**Tech Stack:** Go 1.27, Wails v2.16, React 19, TypeScript 5, Vite 7, existing glass CSS, Vitest 3 + happy-dom for the new frontend tests, pinned `github.com/tailscale/tailcat` v0.7.0 inside the adapter only.

## Global Constraints

- GitHub repo is [mushroom11s/tailcat-box](https://github.com/mushroom11s/tailcat-box). The Go module path is `github.com/mushroom11s/tailcat-box`.
- Shell: Native React/Wails chat UI. Do not load or iframe the official Tailcatchat page.
- Protocol owner: Go adapter dials and listens. The webview does not speak Tailcat itself.
- WebRTC owner: The webview owns `RTCPeerConnection`, `getUserMedia`, and `getDisplayMedia`. Go only carries the signaling envelopes. Do not add a Go WebRTC stack. Phase 1 does not add signaling.
- Nav: Chat + Settings. No Advanced disclosure and no second nav that brings back Connect, Services, or Files.
- Discovery: Paste `tc…` only. Hello on port 100 still runs, because that is how Tailcatchat learns the return address. `#invite=` links are out of these milestones.
- Room key: Ephemeral by default. Settings can select a saved key before the room starts.
- History: Transcript is in memory for this process. Restart shows an empty transcript. (Process restart. The **Restart room** button keeps the transcript; see the spec’s Settings subsection.)
- Caps: A hello advertises only capabilities that build implements. Phase 1 omits `caps`.
- Legacy Go API: Pipe, ports, SSH, SOCKS, exit-node, exec, and SFTP file methods may stay compiled. No product screen calls them.
- English and 简体中文 (`zh-CN`) cover every new user-visible string, using the existing locale switcher and `tailcat-locale` storage.
- Visual language stays the current Apple-inspired / Liquid Glass style, including light, dark, and system theme.
- Only `internal/adapter` imports `github.com/tailscale/tailcat` (`isolation_test.go` already enforces this).
- Keep `TAILCAT_ADAPTER=fake`. Real DERP interop stays out of default CI.
- CI contract stays `go test ./...` and `cd frontend && npm run build`.
- The system line `they're hear meow` stays that English phrase in both locales.
- Copy writes the raw `tc…` address. It does not write a URL.
- Each outbound item dials the peer address on the chosen port, writes in 64 KiB slices, half-closes, drains the read side, and closes.
- Reuse the Wails event `tailcat:event`. `Data` is a JSON string. Existing toolbox event kinds stay as they are.
- Do not delete `frontend/src/pages/ConnectPage.tsx`, `ServicesPage.tsx`, `FilesPage.tsx`, `KeysPage.tsx`, or `DiagnosticsPage.tsx`.
- Do not implement files, resume, burn-after-read, voice notes, WebRTC, `#invite=` links, or a toolbox nav.

## 中文摘要

第一阶段只做导航和文字。侧栏只留「聊天」和「设置」，冷启动进入聊天并开始一个房间，失败则显示重试。用户复制原始 `tc…` 地址，粘贴对方地址后连接；连接发出不带 `caps` 的 hello。收到 hello 后记下对方，并只追加一次英文系统行 `they're hear meow`。文字走端口 101，Box 与 Tailcatchat、Box 与 Box 都能双向收发。密钥 / DERP 和诊断放进设置子区；重启房间才应用所选密钥，记录还在，对方被清空。网页预览和 `TAILCAT_ADAPTER=fake` 都不访问网络。文件、阅后即焚、语音、音视频、邀请链接和工具箱导航都不在本计划里。第二、三、四阶段各自另写计划。

## 范围之外

Do not build any of the following in this plan. Later phases get their own plans.

- `SendChatFile`, `DiscardChatMessage`, `SendChatVoice`, `SendChatSignal`.
- Attach, burn, microphone, or call controls. Absent, not disabled.
- `tc:fake-official`, `tc:fake-resume`, `tc:fake-box`. Those peers are phase 2. In phase 1 they are ordinary unreachable `tc…` addresses.
- Port 102 / 103 product behavior. The listener may accept the TCP stream. The chat service ignores unknown envelope types and does not create a bubble.
- `chat-inbox/` and `chat-partials/`.
- Deleting the toolbox Go API, the key store, or plans 1–4.

## 文件地图

| Path | Responsibility |
| --- | --- |
| `internal/chat/envelope.go` | TCH1 pack/unpack. No Tailcat import. |
| `internal/chat/envelope_test.go` | Golden magic, big-endian length, `v: 1`, extra fields, bad magic, overrun. |
| `internal/chat/service.go` | One room, peer, transcript, hello, text, restart, UI events. |
| `internal/chat/service_test.go` | Lifecycle, hello once, two-room text, echo, errors, restart. |
| `internal/adapter/chat.go` | `ChatAdapter`, `Room`, `RoomOpts`, `ChatEvent`. |
| `internal/adapter/chat_fake.go` | In-process rooms, `tc:fake-echo`, no network. |
| `internal/adapter/chat_fake_test.go` | Two rooms and echo. |
| `internal/adapter/chat_stream.go` | 64 KiB write, `CloseWrite`, drain. |
| `internal/adapter/chat_stream_test.go` | Slice sizes on a fake `net.Conn`. |
| `internal/adapter/chat_real.go` | One `tailcat.Server`, dial ports 100 and 101, discard port 1 bytes into an inbound event. |
| `internal/adapter/adapter.go` | Add `GeneratePrivateKeyJSON`. |
| `internal/adapter/fake.go` | Fake key JSON for saved room keys. |
| `internal/session/session.go` | `KindChat`. |
| `internal/store/keys.go` | Persist `PrivateKey` on create; `ReadRaw`. |
| `app.go` | Chat Wails methods, event fan-in, list the chat session. |
| `app_test.go` | Fake room, echo, restart changes address. |
| `main.go` | Window title `Tailcat Box`. |
| `frontend/src/lib/chatBrowser.ts` | In-browser room/hello/text hub. |
| `frontend/src/lib/chatText.ts` | Locale mapping for system lines and known errors. |
| `frontend/src/lib/wails.ts` | Chat methods; `hasWailsBindings` watches `StartChatRoom`. |
| `frontend/src/pages/ChatPage.tsx` | Address, peer, transcript, composer. |
| `frontend/src/components/KeysDERPSection.tsx` | Keys, DERP, room key, restart. Does not import `KeysPage`. |
| `frontend/src/components/DiagnosticsSection.tsx` | Chat session, event log, ping. Does not import `DiagnosticsPage`. |
| `frontend/src/App.tsx` | Nav `chat \| settings`, cold start on Chat, room lifetime above the page. |
| `frontend/src/pages/SettingsPage.tsx` | Mount the two subsections under the existing cards. |
| `frontend/src/i18n/en.ts`, `zh-CN.ts`, `locale.ts` | New chrome strings and the `chat` session kind. |
| `frontend/src/styles/glass.css` | Chat transcript layout on the existing glass styles. |
| `frontend/index.html` | Initial document title. |
| `frontend/src/App.chat.test.tsx` | Nav, copy, echo, settings, no toolbox pages. |
| `frontend/vitest.config.ts` | happy-dom test runner. |

Dependency rule: `internal/chat` imports `internal/adapter`. The adapter must not import `internal/chat`. The fake echo reply therefore packs TCH1 with `packFrame` inside `chat_fake.go`. `internal/chat` tests are the drift check: they assert the echo body is `echo`.

`SendEnvelope` takes the already packed frame (`[]byte`), not a meta map. `internal/chat` calls `Pack` first. That keeps hashing and capability decisions out of the adapter, and it avoids an import cycle. Later phases call the same method with a different frame.

---

### Task 1: TCH1 信封编解码

**Files:**
- Create: `internal/chat/envelope.go`
- Test: `internal/chat/envelope_test.go`

**Interfaces:**
- Consumes: nothing
- Produces:

```go
func Pack(meta map[string]any, payload []byte) ([]byte, error)
func Unpack(frame []byte) (map[string]any, []byte, error)
```

`Pack` copies `meta`, sets `v` to `1`, and does not add `caps`. `Unpack` returns a map so unknown JSON fields survive. A bad magic or an overrun length returns an error and does not panic.

- [ ] **Step 1: Write the failing test**

Create `internal/chat/envelope_test.go`:

```go
package chat

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func golden(meta []byte, payload []byte) []byte {
	frame := make([]byte, 8+len(meta)+len(payload))
	copy(frame[:4], []byte("TCH1"))
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(meta)))
	copy(frame[8:], meta)
	copy(frame[8+len(meta):], payload)
	return frame
}

func TestUnpackGoldenHelloAndText(t *testing.T) {
	hello := golden([]byte(`{"v":1,"type":"hello","replyTo":"tc:abc"}`), nil)
	meta, payload, err := Unpack(hello)
	if err != nil {
		t.Fatal(err)
	}
	if meta["type"] != "hello" || meta["replyTo"] != "tc:abc" || len(payload) != 0 {
		t.Fatalf("meta=%v payload=%q", meta, payload)
	}
	if _, ok := meta["v"].(float64); !ok || meta["v"].(float64) != 1 {
		t.Fatalf("v=%v", meta["v"])
	}

	text := golden([]byte(`{"v":1,"type":"text","burn":true,"ttlSec":0}`), []byte("hi"))
	meta, payload, err = Unpack(text)
	if err != nil {
		t.Fatal(err)
	}
	if meta["type"] != "text" || string(payload) != "hi" {
		t.Fatalf("meta=%v payload=%q", meta, payload)
	}
	if meta["burn"] != true || meta["ttlSec"].(float64) != 0 {
		t.Fatalf("extra=%v", meta)
	}
}

func TestPackForcesVersionAndOmitsCaps(t *testing.T) {
	frame, err := Pack(map[string]any{"type": "hello", "replyTo": "tc:abc", "v": 2}, nil)
	if err != nil {
		t.Fatal(err)
	}
	meta, _, err := Unpack(frame)
	if err != nil {
		t.Fatal(err)
	}
	if meta["v"].(float64) != 1 {
		t.Fatalf("v=%v", meta["v"])
	}
	if bytes.Contains(frame, []byte("caps")) {
		t.Fatalf("phase 1 hello must not contain caps: %s", frame)
	}
	if string(frame[:4]) != "TCH1" {
		t.Fatalf("magic %q", frame[:4])
	}
}

func TestUnpackRejectsBadMagicAndOverrun(t *testing.T) {
	if _, _, err := Unpack([]byte("XXXX\x00\x00\x00\x02{}")); err == nil {
		t.Fatal("expected bad magic")
	}
	short := []byte("TCH1\x00\x00\x00\x10{}")
	if _, _, err := Unpack(short); err == nil {
		t.Fatal("expected overrun")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/chat/ -count=1`

Expected: FAIL with `undefined: Unpack` (package or build failure before assertions).

- [ ] **Step 3: Write minimal implementation**

Create `internal/chat/envelope.go`:

```go
package chat

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

func Pack(meta map[string]any, payload []byte) ([]byte, error) {
	out := make(map[string]any, len(meta)+1)
	for k, v := range meta {
		out[k] = v
	}
	out["v"] = 1
	body, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if uint64(len(body)) > uint64(^uint32(0)) {
		return nil, fmt.Errorf("meta too large")
	}
	frame := make([]byte, 8+len(body)+len(payload))
	copy(frame[:4], []byte("TCH1"))
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(body)))
	copy(frame[8:], body)
	copy(frame[8+len(body):], payload)
	return frame, nil
}

func Unpack(frame []byte) (map[string]any, []byte, error) {
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
	payload := append([]byte(nil), frame[8+int(n):]...)
	return meta, payload, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/chat/ -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/chat/envelope.go internal/chat/envelope_test.go
git commit -m "feat: add TCH1 envelope codec"
```

---

### Task 2: 假 ChatAdapter（房间、hello、文字）

**Files:**
- Create: `internal/adapter/chat.go`
- Create: `internal/adapter/chat_fake.go`
- Create: `internal/adapter/chat_fake_test.go`
- Modify: `internal/adapter/adapter.go` (append one method to `TailcatAdapter`)
- Modify: `internal/adapter/fake.go` (add the fake method)
- Modify: `internal/adapter/real.go` (add the real key method only; room listen is Task 3)

**Interfaces:**
- Consumes: nothing from Task 1. The fake packs its echo reply itself.
- Produces:

```go
type RoomOpts struct {
	SessionID      string
	PrivateKeyJSON string
	Region         string
	DERPMapURL     string
}

type ChatEventKind string

const (
	ChatEventReady   ChatEventKind = "ready"
	ChatEventInbound ChatEventKind = "inbound"
	ChatEventClosed  ChatEventKind = "closed"
)

type ChatEvent struct {
	SessionID string
	Kind      ChatEventKind
	Address   string
	Port      uint16
	Data      []byte
	Err       string
}

type Room interface {
	SessionID() string
	Address() string
	SetPeer(addr string) error
	SendEnvelope(ctx context.Context, port uint16, frame []byte) error
	Events() <-chan ChatEvent
	Close() error
}

type ChatAdapter interface {
	StartRoom(ctx context.Context, opts RoomOpts) (Room, error)
}

func (f *Fake) GeneratePrivateKeyJSON() (string, error)
func (r *Real) GeneratePrivateKeyJSON() (string, error)
```

Empty `PrivateKeyJSON` yields `tc:fake-room-<sessionID>`. Non-empty material yields `tc:fake-room-key-` plus the first 6 bytes of SHA-256, hex encoded. `tc:fake-echo` accepts a port-101 frame and pushes one inbound text frame whose payload is `echo`. Two rooms in one `*Fake` deliver frames by the peer address. No method body panics.

- [ ] **Step 1: Write the failing test**

Create `internal/adapter/chat_fake_test.go`:

```go
package adapter

import (
	"context"
	"strings"
	"testing"
	"time"
)

func readReady(t *testing.T, room Room) string {
	t.Helper()
	select {
	case ev := <-room.Events():
		if ev.Kind != ChatEventReady || !strings.HasPrefix(ev.Address, "tc:") {
			t.Fatalf("event=%+v", ev)
		}
		return ev.Address
	case <-time.After(2 * time.Second):
		t.Fatal("no ready event")
	}
	return ""
}

func TestFakeTwoRoomsDeliverText(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	a, err := fake.StartRoom(ctx, RoomOpts{SessionID: "aaa"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := fake.StartRoom(ctx, RoomOpts{SessionID: "bbb"})
	if err != nil {
		t.Fatal(err)
	}
	addrA := readReady(t, a)
	addrB := readReady(t, b)
	if err := a.SetPeer(addrB); err != nil {
		t.Fatal(err)
	}
	frame := []byte("TCH1frame-from-a")
	if err := a.SendEnvelope(ctx, 101, frame); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-b.Events():
		if ev.Kind != ChatEventInbound || ev.Port != 101 || string(ev.Data) != string(frame) {
			t.Fatalf("%+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("b got nothing")
	}
	if addrA == addrB {
		t.Fatal("addresses must differ")
	}
}

func TestFakeEchoAnswersTextOnly(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	room, err := fake.StartRoom(ctx, RoomOpts{SessionID: "echo1"})
	if err != nil {
		t.Fatal(err)
	}
	_ = readReady(t, room)
	if err := room.SetPeer("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := room.SendEnvelope(ctx, 100, []byte("hello-frame")); err != nil {
		t.Fatal(err)
	}
	if err := room.SendEnvelope(ctx, 101, []byte("text-frame")); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-room.Events():
		if ev.Port != 101 || !strings.Contains(string(ev.Data), "echo") {
			t.Fatalf("%+v data=%s", ev, ev.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no echo")
	}
}

func TestFakeSavedKeyChangesAddress(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	ephemeral, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	addr1 := readReady(t, ephemeral)
	_ = ephemeral.Close()
	keyed, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s2", PrivateKeyJSON: `{"fake":"alpha"}`})
	if err != nil {
		t.Fatal(err)
	}
	addr2 := readReady(t, keyed)
	_ = keyed.Close()
	again, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s3", PrivateKeyJSON: `{"fake":"alpha"}`})
	if err != nil {
		t.Fatal(err)
	}
	addr3 := readReady(t, again)
	if !strings.HasPrefix(addr1, "tc:fake-room-s1") {
		t.Fatalf("ephemeral=%s", addr1)
	}
	if addr2 == addr1 || !strings.HasPrefix(addr2, "tc:fake-room-key-") {
		t.Fatalf("keyed=%s", addr2)
	}
	if addr3 != addr2 {
		t.Fatalf("same key %s vs %s", addr2, addr3)
	}
}

func TestGeneratePrivateKeyJSON(t *testing.T) {
	fake := NewFake()
	a, err := fake.GeneratePrivateKeyJSON()
	if err != nil || !strings.Contains(a, "fake") {
		t.Fatalf("%s %v", a, err)
	}
	b, err := fake.GeneratePrivateKeyJSON()
	if err != nil || a == b {
		t.Fatalf("expected unique material %s %s", a, b)
	}
	real := NewReal()
	raw, err := real.GeneratePrivateKeyJSON()
	if err != nil || !strings.Contains(raw, "Private") {
		t.Fatalf("%s %v", raw, err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/adapter/ -count=1 -run 'TestFake|TestGeneratePrivateKeyJSON'`

Expected: FAIL to compile (`StartRoom` undefined, or `GeneratePrivateKeyJSON` undefined).

- [ ] **Step 3: Write minimal implementation**

Create `internal/adapter/chat.go`:

```go
package adapter

import "context"

type RoomOpts struct {
	SessionID      string
	PrivateKeyJSON string
	Region         string
	DERPMapURL     string
}

type ChatEventKind string

const (
	ChatEventReady   ChatEventKind = "ready"
	ChatEventInbound ChatEventKind = "inbound"
	ChatEventClosed  ChatEventKind = "closed"
)

type ChatEvent struct {
	SessionID string
	Kind      ChatEventKind
	Address   string
	Port      uint16
	Data      []byte
	Err       string
}

type Room interface {
	SessionID() string
	Address() string
	SetPeer(addr string) error
	SendEnvelope(ctx context.Context, port uint16, frame []byte) error
	Events() <-chan ChatEvent
	Close() error
}

type ChatAdapter interface {
	StartRoom(ctx context.Context, opts RoomOpts) (Room, error)
}
```

Append to the `TailcatAdapter` interface in `internal/adapter/adapter.go`, after `NetworkOpts() NetworkOpts`:

```go
	// GeneratePrivateKeyJSON returns key material stored with a named key.
	// Real returns tailcat.PrivateKey JSON. Fake returns unique {"fake":"..."} JSON.
	GeneratePrivateKeyJSON() (string, error)
```

Add to `internal/adapter/fake.go` inside the `Fake` struct:

```go
	chatRooms map[string]*fakeRoom
```

`NewFake` does not need to allocate `chatRooms`; `StartRoom` allocates it.

Add this method to `fake.go` (or `chat_fake.go`; one definition only):

```go
func (f *Fake) GeneratePrivateKeyJSON() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return `{"fake":"` + hex.EncodeToString(b) + `"}`, nil
}
```

Add imports `crypto/rand` and `encoding/hex` to `fake.go` if the method lives there. Prefer the method on `Fake` in `chat_fake.go` and add those imports in that file instead. Do not define it twice.

Create `internal/adapter/chat_fake.go`:

```go
package adapter

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

func fakeRoomAddress(sessionID, keyJSON string) string {
	if keyJSON == "" {
		return "tc:fake-room-" + sessionID
	}
	sum := sha256.Sum256([]byte(keyJSON))
	return "tc:fake-room-key-" + hex.EncodeToString(sum[:6])
}

func packFrame(meta map[string]any, payload []byte) ([]byte, error) {
	meta["v"] = 1
	body, err := json.Marshal(meta)
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
	if peer == "tc:fake-echo" {
		if port == 101 {
			reply, err := packFrame(map[string]any{"type": "text"}, []byte("echo"))
			if err != nil {
				return err
			}
			return r.owner.deliver(r.addr, 101, reply)
		}
		return nil
	}
	return r.owner.deliver(peer, port, frame)
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
		delete(r.owner.chatRooms, r.addr)
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
```

`SetPeer` checks `r.events == nil` under the lock. `SendEnvelope` copies `peer` under the same lock. Closing nil’s the channel only inside `once`.

Add to `internal/adapter/real.go`:

```go
func (r *Real) GeneratePrivateKeyJSON() (string, error) {
	pk := tailcat.NewPrivateKey()
	body, err := json.Marshal(pk)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
```

Add `"encoding/json"` to the imports of `real.go`.

Fix `fakeRoom.SetPeer` / `SendEnvelope` so a closed room cannot send on a nil map. The `events == nil` check is the closed flag. `deliver` also checks `target.events == nil`.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/adapter/ -count=1`

Expected: PASS, including existing toolbox tests.

- [ ] **Step 5: Commit**

```bash
git add internal/adapter/chat.go internal/adapter/chat_fake.go internal/adapter/chat_fake_test.go internal/adapter/adapter.go internal/adapter/fake.go internal/adapter/real.go
git commit -m "feat: add fake chat adapter for room hello and text"
```

---

### Task 3: 真适配器按 64 KiB 半关闭发送

**Files:**
- Create: `internal/adapter/chat_stream.go`
- Create: `internal/adapter/chat_stream_test.go`
- Create: `internal/adapter/chat_real.go`

**Interfaces:**
- Consumes: `Room`, `RoomOpts`, `ChatEvent`, `ChatAdapter` from Task 2. `(*Real).applyServerNet`, `(*Real).newClient`, `(*Real).resolveRegionID` already exist.
- Produces: `func (r *Real) StartRoom(ctx context.Context, opts RoomOpts) (Room, error)` and

```go
func writeAndHalfClose(conn net.Conn, frame []byte) error
```

`StartRoom` listens with one `tailcat.Server`. Empty key JSON leaves `Server.Key` zero so Start mints an ephemeral key. Non-empty JSON must unmarshal as `tailcat.PrivateKey` with a non-zero `Private`; otherwise return `saved key is not a Tailcat private key`. `OnTCP` accepts ports 1, 100, 101, 102, and 103, reads at most 1 MiB (`maxChatFrame = 1 << 20`), and emits `ChatEventInbound`. Phase 2 must raise that cap before file transfer. Outbound `SendEnvelope` dials `DialTCPPort`, writes 64 KiB slices, half-closes, drains, and closes. A dial or write error returns to the caller. Do not add file, voice, or WebRTC methods.

- [ ] **Step 1: Write the failing test**

Create `internal/adapter/chat_stream_test.go`:

```go
package adapter

import (
	"io"
	"net"
	"testing"
	"time"
)

type scriptConn struct {
	writes [][]byte
	half   bool
	closed bool
}

func (c *scriptConn) Read(p []byte) (int, error) { return 0, io.EOF }
func (c *scriptConn) Write(p []byte) (int, error) {
	c.writes = append(c.writes, append([]byte(nil), p...))
	return len(p), nil
}
func (c *scriptConn) Close() error                       { c.closed = true; return nil }
func (c *scriptConn) CloseWrite() error                  { c.half = true; return nil }
func (c *scriptConn) LocalAddr() net.Addr                { return nil }
func (c *scriptConn) RemoteAddr() net.Addr               { return nil }
func (c *scriptConn) SetDeadline(time.Time) error        { return nil }
func (c *scriptConn) SetReadDeadline(time.Time) error    { return nil }
func (c *scriptConn) SetWriteDeadline(time.Time) error   { return nil }

func TestWriteAndHalfCloseUses64KiBSlices(t *testing.T) {
	frame := make([]byte, 64*1024+100)
	for i := range frame {
		frame[i] = byte(i)
	}
	conn := &scriptConn{}
	if err := writeAndHalfClose(conn, frame); err != nil {
		t.Fatal(err)
	}
	if len(conn.writes) != 2 || len(conn.writes[0]) != 64*1024 || len(conn.writes[1]) != 100 {
		t.Fatalf("writes=%d", len(conn.writes))
	}
	if !conn.half || !conn.closed {
		t.Fatalf("half=%v closed=%v", conn.half, conn.closed)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/adapter/ -count=1 -run TestWriteAndHalfCloseUses64KiBSlices`

Expected: FAIL to compile (`undefined: writeAndHalfClose`).

- [ ] **Step 3: Write minimal implementation**

Create `internal/adapter/chat_stream.go`:

```go
package adapter

import (
	"io"
	"net"
)

const streamSlice = 64 * 1024

func writeAndHalfClose(conn net.Conn, frame []byte) error {
	for len(frame) > 0 {
		n := streamSlice
		if n > len(frame) {
			n = len(frame)
		}
		if _, err := conn.Write(frame[:n]); err != nil {
			return err
		}
		frame = frame[n:]
	}
	if cw, ok := conn.(interface{ CloseWrite() error }); ok {
		if err := cw.CloseWrite(); err != nil {
			return err
		}
	}
	_, _ = io.Copy(io.Discard, conn)
	return conn.Close()
}
```

Create `internal/adapter/chat_real.go`:

```go
package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
)

const maxChatFrame = 1 << 20

type realRoom struct {
	real   *Real
	srv    *tailcat.Server
	id     string
	addr   string
	peer   string
	events chan ChatEvent
	cancel context.CancelFunc
	once   sync.Once
	mu     sync.Mutex
	done   bool
}

func (r *Real) StartRoom(ctx context.Context, opts RoomOpts) (Room, error) {
	if opts.SessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	ctx, cancel := context.WithCancel(ctx)
	room := &realRoom{
		real:   r,
		id:     opts.SessionID,
		events: make(chan ChatEvent, 16),
		cancel: cancel,
	}
	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	if err := applyRoomKey(srv, opts.PrivateKeyJSON); err != nil {
		cancel()
		return nil, err
	}
	netOpts := r.NetworkOpts()
	if opts.Region != "" || opts.DERPMapURL != "" {
		netOpts = NetworkOpts{Region: opts.Region, DERPMapURL: opts.DERPMapURL}
	}
	if netOpts.DERPMapURL != "" {
		srv.DERPMapURL = netOpts.DERPMapURL
	}
	if rid := r.resolveRegionID(ctx, netOpts); rid != 0 {
		srv.RegionID = tailcfg.DERPRegionID(rid)
	}
	srv.OnTCP = func(port uint16) func(net.Conn) {
		switch port {
		case 1, 100, 101, 102, 103:
		default:
			return nil
		}
		return func(c net.Conn) {
			defer c.Close()
			data, _ := io.ReadAll(io.LimitReader(c, maxChatFrame))
			room.emit(ChatEvent{SessionID: room.id, Kind: ChatEventInbound, Port: port, Data: data})
		}
	}
	if err := srv.Start(); err != nil {
		cancel()
		return nil, err
	}
	room.srv = srv
	room.addr = string(srv.TailcatAddr())
	r.mu.Lock()
	if r.chat != nil {
		old := r.chat
		r.chat = nil
		r.mu.Unlock()
		_ = old.Close()
		r.mu.Lock()
	}
	r.chat = room
	r.mu.Unlock()
	room.emit(ChatEvent{SessionID: room.id, Kind: ChatEventReady, Address: room.addr})
	go func() {
		<-ctx.Done()
		_ = room.Close()
	}()
	return room, nil
}

func applyRoomKey(srv *tailcat.Server, keyJSON string) error {
	if keyJSON == "" {
		return nil
	}
	var pk tailcat.PrivateKey
	if err := json.Unmarshal([]byte(keyJSON), &pk); err != nil || pk.Private.IsZero() {
		return fmt.Errorf("saved key is not a Tailcat private key")
	}
	srv.Key = pk.Private
	var zero tailcat.PresharedKey
	if pk.Public.PresharedKey != zero {
		srv.PresharedKey = pk.Public.PresharedKey
	}
	return nil
}

func (r *realRoom) emit(ev ChatEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return
	}
	select {
	case r.events <- ev:
	default:
	}
}

func (r *realRoom) SessionID() string { return r.id }
func (r *realRoom) Address() string   { return r.addr }
func (r *realRoom) Events() <-chan ChatEvent {
	return r.events
}

func (r *realRoom) SetPeer(addr string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.srv == nil {
		return fmt.Errorf("room closed")
	}
	r.peer = addr
	return nil
}

func (r *realRoom) SendEnvelope(ctx context.Context, port uint16, frame []byte) error {
	r.mu.Lock()
	peer := r.peer
	srv := r.srv
	r.mu.Unlock()
	if srv == nil {
		return fmt.Errorf("room closed")
	}
	if peer == "" {
		return fmt.Errorf("no peer")
	}
	cl := r.real.newClient(peer)
	defer cl.Close()
	conn, err := cl.DialTCPPort(ctx, port)
	if err != nil {
		return err
	}
	return writeAndHalfClose(conn, frame)
}

func (r *realRoom) Close() error {
	r.once.Do(func() {
		r.mu.Lock()
		r.done = true
		srv := r.srv
		r.srv = nil
		r.mu.Unlock()
		r.cancel()
		if srv != nil {
			_ = srv.Close()
		}
		r.real.mu.Lock()
		if r.real.chat == r {
			r.real.chat = nil
		}
		r.real.mu.Unlock()
		close(r.events)
	})
	return nil
}

var _ ChatAdapter = (*Real)(nil)
```

Add this field to `Real` in `internal/adapter/real.go`:

```go
	chat *realRoom
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/adapter/ -count=1`

Expected: PASS. This does not dial DERP.

- [ ] **Step 5: Commit**

```bash
git add internal/adapter/chat_stream.go internal/adapter/chat_stream_test.go internal/adapter/chat_real.go internal/adapter/real.go
git commit -m "feat: dial chat envelopes with the real Tailcat adapter"
```

---

### Task 4: 聊天服务（房间、hello、文字、重启）

**Files:**
- Modify: `internal/session/session.go` (add `KindChat`)
- Create: `internal/chat/service.go`
- Create: `internal/chat/service_test.go`

**Interfaces:**
- Consumes: `adapter.ChatAdapter`, `adapter.RoomOpts`, `adapter.ChatEventReady`, `adapter.ChatEventInbound`, `Pack`, `Unpack`, `session.Kind`.
- Produces:

```go
const KindChat session.Kind = "chat"

type StartOpts struct {
	PrivateKeyJSON string
	Region         string
	DERPMapURL     string
	KeyName        string
}

type Message struct {
	ID        string `json:"id"`
	Direction string `json:"direction"` // in, out, system
	Type      string `json:"type"`      // text, system
	Code      string `json:"code,omitempty"`
	Body      string `json:"body"`
	At        string `json:"at"`
}

func New(ad adapter.ChatAdapter) *Service
func (s *Service) Start(opts StartOpts) (session.Session, error)
func (s *Service) Connect(addr string) error
func (s *Service) SendText(body string) error
func (s *Service) Restart(opts StartOpts) (session.Session, error)
func (s *Service) Stop() error
func (s *Service) Session() (session.Session, bool)
func (s *Service) Messages() []Message
func (s *Service) Peer() string
func (s *Service) Events() <-chan adapter.Event
```

UI event kinds on `adapter.Event` (the existing toolbox struct), `Data` a JSON string:

| Kind | Data |
| --- | --- |
| `room-ready` | `{"address":"tc:…"}` |
| `peer` | `{"address":"tc:…","caps":["…"]}` — omit `caps` when the hello had none |
| `message` | `Message` JSON |
| `error` | `{"message":"…","scope":"room"}` only when listen fails after the room object exists |

User-facing strings, exact:

- `Paste a Tailcat address that starts with tc.`
- `Could not reach peer. Check the address and that they are online.`
- system `they're hear meow` with code `hear-meow`
- system `Peer changed` with code `peer-changed`
- system `Room restarted. Send the new address.` with code `room-restarted`
- system `Could not read a message.` with code `bad-frame`
- diagnostic `adapter.Event{Kind: "data", Data: "ignored port 1 stream"}` for port 1, no message

A second `Start` while status is `starting` or `running` returns that session. `Connect` sets the peer, then sends `{type:"hello", replyTo:<local>}` on port 100 with no `caps` key, and does not append `they're hear meow`. An inbound hello whose `replyTo` starts with `tc` sets the peer and appends that line once. The same `replyTo` does not append it again. A different non-empty peer also appends `Peer changed` and keeps older messages. `SendText` uses port 101. Empty text is a nil error and does not send. Dial failure returns the unreachable sentence and does not append an outbound bubble. Unknown `type` is ignored. `Restart` closes the listener, clears the peer, keeps messages, appends the restarted line, emits `peer` with `{"address":""}`, and starts a new session. `Stop` closes the listener and clears the peer.

- [ ] **Step 1: Write the failing lifecycle test**

Add `KindChat Kind = "chat"` next to the other kinds in `internal/session/session.go` before writing the test, or let the test fail first and add the constant in Step 3. The test below needs the constant, so Step 1 may fail on `undefined: session.KindChat`. That is the expected failure.

Create `internal/chat/service_test.go`:

```go
package chat

import (
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

func waitRunning(t *testing.T, svc *Service) session.Session {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		sess, ok := svc.Session()
		if ok && sess.Status == session.StatusRunning && strings.HasPrefix(sess.Address, "tc:") {
			return sess
		}
		select {
		case <-deadline:
			t.Fatalf("not running: %+v", sess)
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestStartIsIdempotentAndStop(t *testing.T) {
	svc := New(adapter.NewFake())
	first, err := svc.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Kind != session.KindChat {
		t.Fatalf("kind=%s", first.Kind)
	}
	ready := waitRunning(t, svc)
	second, err := svc.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != ready.ID || second.Address != ready.Address {
		t.Fatalf("second=%+v ready=%+v", second, ready)
	}
	if err := svc.Stop(); err != nil {
		t.Fatal(err)
	}
	stopped, ok := svc.Session()
	if !ok || stopped.Status != session.StatusStopped || svc.Peer() != "" {
		t.Fatalf("stopped=%+v peer=%s", stopped, svc.Peer())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/chat/ -count=1 -run TestStartIsIdempotentAndStop`

Expected: FAIL to compile (`undefined: New` or `undefined: session.KindChat`).

- [ ] **Step 3: Write the lifecycle implementation**

In `internal/session/session.go`, add under the other kind constants:

```go
	KindChat Kind = "chat"
```

Create `internal/chat/service.go` with lifecycle only. Hello and text land in later steps of this task; include the fields they need so those steps add methods rather than renaming fields.

```go
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
	Body      string `json:"body"`
	At        string `json:"at"`
}

type Service struct {
	ad       adapter.ChatAdapter
	mu       sync.Mutex
	sess     *session.Session
	room     adapter.Room
	cancel   context.CancelFunc
	peer     string
	messages []Message
	ui       chan adapter.Event
	opening  bool
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

func (s *Service) Stop() error {
	s.shutdown(true)
	return nil
}

func (s *Service) shutdown(markStopped bool) {
	s.mu.Lock()
	room := s.room
	cancel := s.cancel
	sess := s.sess
	s.room = nil
	s.cancel = nil
	s.peer = ""
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
	if restarted {
		s.messages = append(s.messages, newMessage("system", "system", codeRoomRestarted, bodyRoomRestarted))
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
	var restartedMsg *Message
	if restarted && len(s.messages) > 0 {
		msg := s.messages[len(s.messages)-1]
		restartedMsg = &msg
	}
	s.mu.Unlock()
	if restartedMsg != nil {
		s.emitMessage(sess.ID, *restartedMsg)
		s.emit(adapter.Event{SessionID: sess.ID, Kind: "peer", Data: `{"address":""}`})
	}
	go s.readLoop(room, sess.ID)
	return *sess, nil
}

func (s *Service) readLoop(room adapter.Room, sessionID string) {
	for ev := range room.Events() {
		if ev.Kind == adapter.ChatEventReady {
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
		}
	}
}

func (s *Service) emit(ev adapter.Event) {
	select {
	case s.ui <- ev:
	default:
	}
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

func (s *Service) emitMessage(sessionID string, msg Message) {
	body, _ := json.Marshal(msg)
	s.emit(adapter.Event{SessionID: sessionID, Kind: "message", Data: string(body)})
}
```

`open` on restart appends the system message before listen succeeds. If listen fails, the transcript still contains that line and `Start`/`Restart` returns the adapter error. The UI shows it as the room error.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/chat/ -count=1 -run 'TestStartIsIdempotentAndStop|TestUnpack|TestPack'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/session/session.go internal/chat/service.go internal/chat/service_test.go
git commit -m "feat: start and stop one in-memory chat room"
```

- [ ] **Step 6: Write the failing hello and text tests**

Append to `internal/chat/service_test.go`:

```go
func TestPeerChangeKeepsEarlierText(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	c := New(fake)
	if _, err := a.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	readyB := waitRunning(t, b)
	readyC := waitRunning(t, c)
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	if err := a.SendText("first"); err != nil {
		t.Fatal(err)
	}
	if err := a.Connect(readyC.Address); err != nil {
		t.Fatal(err)
	}
	if a.Peer() != readyC.Address || !hasBody(a, "out", "first") || countCode(a, codePeerChanged) != 1 {
		t.Fatalf("peer=%s messages=%+v", a.Peer(), a.Messages())
	}
}

func TestHelloOnceAndTextBothWays(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	if _, err := a.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	readyA := waitRunning(t, a)
	readyB := waitRunning(t, b)
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for svcPeer(b) != readyA.Address || countCode(b, codeHearMeow) != 1 {
		select {
		case <-deadline:
			t.Fatalf("peer=%s messages=%+v", b.Peer(), b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if countCode(b, codeHearMeow) != 1 {
		t.Fatalf("duplicated hear meow: %+v", b.Messages())
	}
	if err := b.SendText("from-b"); err != nil {
		t.Fatal(err)
	}
	if err := a.SendText("from-a"); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	for !hasBody(a, "in", "from-b") || !hasBody(b, "in", "from-a") {
		select {
		case <-deadline:
			t.Fatalf("a=%+v b=%+v", a.Messages(), b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestConnectHelloOmitsCaps(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:peer"); err != nil {
		t.Fatal(err)
	}
	if len(mem.sent) != 1 || mem.sent[0].port != 100 {
		t.Fatalf("sent=%+v", mem.sent)
	}
	meta, _, err := Unpack(mem.sent[0].frame)
	if err != nil {
		t.Fatal(err)
	}
	if meta["type"] != "hello" || meta["replyTo"] == "" {
		t.Fatalf("meta=%v", meta)
	}
	if _, ok := meta["caps"]; ok {
		t.Fatalf("caps present: %v", meta)
	}
}

func TestEchoBadFramePort1AndRestart(t *testing.T) {
	svc := New(adapter.NewFake())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	ready := waitRunning(t, svc)
	if err := svc.Connect("tc:not-a-real-peer"); err == nil || err.Error() != errUnreachable {
		t.Fatalf("%v", err)
	}
	if err := svc.Connect("nope"); err == nil || err.Error() != errBadAddr {
		t.Fatalf("%v", err)
	}
	if err := svc.Connect("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendText("hi"); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for !hasBody(svc, "in", "echo") {
		select {
		case <-deadline:
			t.Fatalf("%+v", svc.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	mem := newMemAdapter()
	other := New(mem)
	if _, err := other.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, other)
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 1, Data: []byte("raw")})
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 101, Data: []byte("not-tch1")})
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 101, Data: mustPack(t, map[string]any{"type": "nope"}, nil)})
	time.Sleep(40 * time.Millisecond)
	if countCode(other, codeBadFrame) != 1 {
		t.Fatalf("%+v", other.Messages())
	}
	if hasBody(other, "in", "raw") {
		t.Fatal("port 1 became a bubble")
	}
	seenData := false
	deadline = time.After(time.Second)
	for !seenData {
		select {
		case ev := <-other.Events():
			if ev.Kind == adapter.EventData && ev.Data == "ignored port 1 stream" {
				seenData = true
			}
		case <-deadline:
			t.Fatal("missing port 1 diagnostic")
		}
	}
	if err := svc.SendText("keep-me"); err != nil {
		t.Fatal(err)
	}
	next, err := svc.Restart(StartOpts{PrivateKeyJSON: `{"fake":"beta"}`})
	if err != nil {
		t.Fatal(err)
	}
	again := waitRunning(t, svc)
	if again.ID != next.ID || again.Address == ready.Address || !strings.HasPrefix(again.Address, "tc:fake-room-key-") {
		t.Fatalf("again=%+v old=%s", again, ready.Address)
	}
	if svc.Peer() != "" || !hasBody(svc, "out", "keep-me") || countCode(svc, codeRoomRestarted) != 1 {
		t.Fatalf("peer=%s messages=%+v", svc.Peer(), svc.Messages())
	}
}

func svcPeer(s *Service) string { return s.Peer() }

func countCode(s *Service, code string) int {
	n := 0
	for _, msg := range s.Messages() {
		if msg.Code == code {
			n++
		}
	}
	return n
}

func hasBody(s *Service, direction, body string) bool {
	for _, msg := range s.Messages() {
		if msg.Direction == direction && msg.Body == body {
			return true
		}
	}
	return false
}

func mustPack(t *testing.T, meta map[string]any, payload []byte) []byte {
	t.Helper()
	frame, err := Pack(meta, payload)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

type sentFrame struct {
	port  uint16
	frame []byte
}

type memAdapter struct {
	mu    sync.Mutex
	sent  []sentFrame
	room  *memRoom
}

func newMemAdapter() *memAdapter { return &memAdapter{} }

func (m *memAdapter) StartRoom(ctx context.Context, opts adapter.RoomOpts) (adapter.Room, error) {
	room := &memRoom{id: opts.SessionID, addr: "tc:fake-room-" + opts.SessionID, events: make(chan adapter.ChatEvent, 8), mem: m}
	m.room = room
	room.events <- adapter.ChatEvent{SessionID: room.id, Kind: adapter.ChatEventReady, Address: room.addr}
	return room, nil
}

func (m *memAdapter) push(ev adapter.ChatEvent) {
	m.room.events <- ev
}

type memRoom struct {
	id     string
	addr   string
	peer   string
	events chan adapter.ChatEvent
	mem    *memAdapter
}

func (r *memRoom) SessionID() string { return r.id }
func (r *memRoom) Address() string   { return r.addr }
func (r *memRoom) Events() <-chan adapter.ChatEvent { return r.events }
func (r *memRoom) SetPeer(addr string) error        { r.peer = addr; return nil }
func (r *memRoom) Close() error                     { return nil }
func (r *memRoom) SendEnvelope(ctx context.Context, port uint16, frame []byte) error {
	if r.peer == "tc:not-a-real-peer" {
		return fmt.Errorf("dial failed")
	}
	r.mem.mu.Lock()
	r.mem.sent = append(r.mem.sent, sentFrame{port: port, frame: append([]byte(nil), frame...)})
	r.mem.mu.Unlock()
	return nil
}
```

Add `"sync"` and `"fmt"` to the test imports.

- [ ] **Step 7: Run test to verify it fails**

Run: `go test ./internal/chat/ -count=1 -run 'TestHelloOnce|TestConnectHello|TestEchoBadFrame|TestPeerChange'`

Expected: FAIL to compile (`Connect` undefined).

- [ ] **Step 8: Implement hello, text, and restart**

Add these methods to `internal/chat/service.go`:

```go
func (s *Service) Restart(opts StartOpts) (session.Session, error) {
	s.shutdown(true)
	return s.open(opts, true)
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
	frame, err := Pack(map[string]any{"type": "hello", "replyTo": local}, nil)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := room.SendEnvelope(ctx, portControl, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	s.emitPeer(sid, addr, nil)
	return nil
}

func (s *Service) SendText(body string) error {
	if strings.TrimSpace(body) == "" {
		return nil
	}
	s.mu.Lock()
	if s.peer == "" || s.room == nil {
		s.mu.Unlock()
		return fmt.Errorf("no peer")
	}
	room := s.room
	sid := s.sess.ID
	s.mu.Unlock()
	frame, err := Pack(map[string]any{"type": "text"}, []byte(body))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := room.SendEnvelope(ctx, portText, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	s.addText(sid, "out", body)
	return nil
}

func (s *Service) emitPeer(sessionID, addr string, caps []string) {
	payload := map[string]any{"address": addr}
	if len(caps) > 0 {
		payload["caps"] = caps
	}
	body, _ := json.Marshal(payload)
	s.emit(adapter.Event{SessionID: sessionID, Kind: "peer", Data: string(body)})
}

func (s *Service) addText(sessionID, direction, body string) {
	msg := newMessage(direction, "text", "", body)
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}
```

Replace `readLoop` with:

```go
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
		s.addText(sessionID, "in", string(payload))
	default:
		return
	}
}

func (s *Service) onHello(sessionID string, meta map[string]any) {
	replyTo, _ := meta["replyTo"].(string)
	if !strings.HasPrefix(replyTo, "tc") {
		return
	}
	s.mu.Lock()
	if replyTo == s.peer {
		s.mu.Unlock()
		return
	}
	var changed *Message
	if s.peer != "" {
		msg := newMessage("system", "system", codePeerChanged, bodyPeerChanged)
		s.messages = append(s.messages, msg)
		changed = &msg
	}
	s.peer = replyTo
	hear := newMessage("system", "system", codeHearMeow, bodyHearMeow)
	s.messages = append(s.messages, hear)
	s.mu.Unlock()
	if err := s.roomSetPeer(replyTo); err != nil {
		return
	}
	if changed != nil {
		s.emitMessage(sessionID, *changed)
	}
	s.emitMessage(sessionID, hear)
	s.emitPeer(sessionID, replyTo, capsOf(meta))
}

func (s *Service) roomSetPeer(addr string) error {
	s.mu.Lock()
	room := s.room
	s.mu.Unlock()
	if room == nil {
		return fmt.Errorf("room closed")
	}
	return room.SetPeer(addr)
}

func (s *Service) addSystem(sessionID, code, body string) {
	msg := newMessage("system", "system", code, body)
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
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
```

`onHello` calls `SetPeer` so a later `SendText` from the callee dials `replyTo` without a second Connect. That is the one-Connect two-Box path.

- [ ] **Step 9: Run test to verify it passes**

Run: `go test ./internal/chat/ ./internal/adapter/ ./internal/session/ -count=1`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add internal/chat/service.go internal/chat/service_test.go internal/session/session.go
git commit -m "feat: exchange hello and text in the chat service"
```

---

### Task 5: Wails 绑定与已存密钥

**Files:**
- Modify: `internal/store/keys.go`
- Modify: `internal/store/keys_test.go`
- Modify: `app.go`
- Modify: `app_test.go`
- Modify: `frontend/wailsjs/go/main/App.d.ts` and the generated `App.js` via `wails generate module`

**Interfaces:**
- Consumes: `chat.New`, `chat.StartOpts`, `chat.Service` methods from Task 4, `GeneratePrivateKeyJSON` from Task 2.
- Produces:

```go
func (s *Store) ReadRaw(name string) ([]byte, error)
func roomKeyMaterial(raw []byte) (string, error)

func (a *App) StartChatRoom() (session.Session, error)
func (a *App) ConnectChatPeer(addr string) error
func (a *App) SendChatText(body string) error
func (a *App) RestartChatRoom(keyName string) (session.Session, error)
func (a *App) StopChatRoom() error
```

`ListSessions` appends the current chat session. `forwardEvents` reads both `a.svc.Events()` and `a.chat.Events()`. `CreateKey` stores adapter key material in the existing `*.private.json` file under a `PrivateKey` field and still returns an address string. `RestartChatRoom("")` uses an ephemeral key. A non-empty name reads the file and passes `roomKeyMaterial` into `Restart`. Toolbox methods stay on `App`.

`roomKeyMaterial` returns the embedded `PrivateKey` JSON when that field is present. If the file itself is a Tailcat private key (`Private` field, no wrapper), it returns the whole file. Otherwise it returns `saved key is not a Tailcat private key`.

- [ ] **Step 1: Write the failing store and app tests**

Append to `internal/store/keys_test.go`:

```go
func TestCreateStoresPrivateKeyAndReadRaw(t *testing.T) {
	s := store.New(t.TempDir())
	if _, err := s.Create("home", store.CreateOpts{PrivateKeyJSON: `{"fake":"abc"}`}); err != nil {
		t.Fatal(err)
	}
	raw, err := s.ReadRaw("home")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"PrivateKey"`) || !strings.Contains(string(raw), "abc") {
		t.Fatalf("raw=%s", raw)
	}
}
```

The test file already imports `strings`? If it does not, add `"strings"`.

Append to `app_test.go`:

```go
func TestChatRoomEchoAndRestartKey(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	a := NewApp()
	if _, err := a.StartChatRoom(); err != nil {
		t.Fatal(err)
	}
	var addr string
	deadline := time.After(2 * time.Second)
	for addr == "" {
		for _, item := range a.ListSessions() {
			if item.Kind == session.KindChat && item.Status == session.StatusRunning {
				addr = item.Address
			}
		}
		select {
		case <-deadline:
			t.Fatalf("%+v", a.ListSessions())
		case <-time.After(10 * time.Millisecond):
		}
	}
	again, err := a.StartChatRoom()
	if err != nil || again.Address != addr {
		t.Fatalf("again=%+v err=%v", again, err)
	}
	if err := a.ConnectChatPeer("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := a.SendChatText("hi"); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	for !chatHas(a, "in", "echo") {
		select {
		case <-deadline:
			t.Fatalf("%+v", a.chat.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if _, err := a.CreateKey("home", false, ""); err != nil {
		t.Fatal(err)
	}
	restarted, err := a.RestartChatRoom("home")
	if err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	var next string
	for next == "" {
		for _, item := range a.ListSessions() {
			if item.ID == restarted.ID && item.Status == session.StatusRunning {
				next = item.Address
			}
		}
		select {
		case <-deadline:
			t.Fatalf("%+v", a.ListSessions())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if next == addr || !strings.HasPrefix(next, "tc:fake-room-key-") {
		t.Fatalf("next=%s old=%s", next, addr)
	}
	if a.chat.Peer() != "" {
		t.Fatalf("peer=%s", a.chat.Peer())
	}
}

func chatHas(a *App, direction, body string) bool {
	for _, msg := range a.chat.Messages() {
		if msg.Direction == direction && msg.Body == body {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/store/ ./ -count=1 -run 'TestCreateStoresPrivateKey|TestChatRoomEcho'`

Expected: FAIL to compile (`PrivateKeyJSON` unknown, or `StartChatRoom` undefined).

- [ ] **Step 3: Write minimal implementation**

In `internal/store/keys.go`, extend `fileRecord`:

```go
	PrivateKey json.RawMessage `json:"PrivateKey,omitempty"`
```

Extend `CreateOpts`:

```go
	PrivateKeyJSON string
```

In `Create`, after building `rec`, if `opts.PrivateKeyJSON != ""`:

```go
	if opts.PrivateKeyJSON != "" {
		if !json.Valid([]byte(opts.PrivateKeyJSON)) {
			return "", fmt.Errorf("private key JSON is invalid")
		}
		rec.PrivateKey = json.RawMessage(opts.PrivateKeyJSON)
	}
```

Add:

```go
func (s *Store) ReadRaw(name string) ([]byte, error) {
	if err := validateName(name); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(filepath.Join(s.Dir, name+keySuffix))
	if err == nil {
		return body, nil
	}
	if s.ExtraDir != "" && os.IsNotExist(err) {
		if extra, err2 := os.ReadFile(filepath.Join(s.ExtraDir, name+keySuffix)); err2 == nil {
			return extra, nil
		}
	}
	return nil, err
}
```

In `app.go`, change `newAdapter` into:

```go
func newAdapters() (adapter.TailcatAdapter, adapter.ChatAdapter) {
	if strings.EqualFold(os.Getenv("TAILCAT_ADAPTER"), "fake") {
		f := adapter.NewFake()
		return f, f
	}
	r := adapter.NewReal()
	return r, r
}
```

Add field `chat *chat.Service` on `App`. In `NewApp`:

```go
	ad, chatAd := newAdapters()
	keys := newKeyStore()
	svc := service.New(ad)
	if settings, err := keys.LoadSettings(); err == nil {
		svc.SetNetworkOpts(adapter.NetworkOpts{Region: settings.Region, DERPMapURL: settings.DERPMapURL})
	}
	return &App{
		svc:       svc,
		chat:      chat.New(chatAd),
		keys:      keys,
		settings:  newSettingsStore(),
		startedAt: time.Now(),
	}
```

Add the import `"github.com/mushroom11s/tailcat-box/internal/chat"`.

Replace `forwardEvents`:

```go
func (a *App) forwardEvents() {
	emit := func(ev adapter.Event) {
		if a.tray != nil {
			a.tray.Refresh()
		}
		if a.ctx == nil {
			return
		}
		runtime.EventsEmit(a.ctx, tailcatEventName, ev)
	}
	go func() {
		for ev := range a.svc.Events() {
			emit(ev)
		}
	}()
	for ev := range a.chat.Events() {
		emit(ev)
	}
}
```

Replace `activeSessionCount` to use `a.ListSessions()`.

Replace `ListSessions`:

```go
func (a *App) ListSessions() []session.Session {
	out := a.svc.List()
	if a.chat != nil {
		if sess, ok := a.chat.Session(); ok {
			out = append(out, sess)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}
```

Add `"sort"` to the imports.

Replace `CreateKey`:

```go
func (a *App) CreateKey(name string, client bool, region string) (string, error) {
	material, err := a.keygen().GeneratePrivateKeyJSON()
	if err != nil {
		return "", err
	}
	return a.keys.Create(name, store.CreateOpts{Client: client, Region: region, PrivateKeyJSON: material})
}
```

`GeneratePrivateKeyJSON` is on the concrete adapter, not on `service.Service`. Store the `adapter.TailcatAdapter` the app already wraps, or type-assert. Add this helper that uses the same object passed to `service.New`:

```go
type keyGenerator interface {
	GeneratePrivateKeyJSON() (string, error)
}

func (a *App) keygen() keyGenerator {
	return a.svcAdapter
}
```

Add field `svcAdapter adapter.TailcatAdapter` set in `NewApp` to `ad` before `service.New(ad)`.

Add:

```go
func roomKeyMaterial(raw []byte) (string, error) {
	var wrap struct {
		PrivateKey json.RawMessage `json:"PrivateKey"`
		Private    json.RawMessage `json:"Private"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return "", fmt.Errorf("saved key is not a Tailcat private key")
	}
	if len(wrap.PrivateKey) > 0 && string(wrap.PrivateKey) != "null" {
		return string(wrap.PrivateKey), nil
	}
	if len(wrap.Private) > 0 && string(wrap.Private) != "null" {
		return string(raw), nil
	}
	return "", fmt.Errorf("saved key is not a Tailcat private key")
}

func (a *App) chatOpts(keyName string) (chat.StartOpts, error) {
	net := a.svc.NetworkOpts()
	opts := chat.StartOpts{Region: net.Region, DERPMapURL: net.DERPMapURL, KeyName: strings.TrimSpace(keyName)}
	if opts.KeyName == "" {
		return opts, nil
	}
	raw, err := a.keys.ReadRaw(opts.KeyName)
	if err != nil {
		return chat.StartOpts{}, err
	}
	material, err := roomKeyMaterial(raw)
	if err != nil {
		return chat.StartOpts{}, err
	}
	opts.PrivateKeyJSON = material
	return opts, nil
}

func (a *App) StartChatRoom() (session.Session, error) {
	opts, err := a.chatOpts("")
	if err != nil {
		return session.Session{}, err
	}
	return a.chat.Start(opts)
}

func (a *App) ConnectChatPeer(addr string) error {
	return a.chat.Connect(addr)
}

func (a *App) SendChatText(body string) error {
	return a.chat.SendText(body)
}

func (a *App) RestartChatRoom(keyName string) (session.Session, error) {
	opts, err := a.chatOpts(keyName)
	if err != nil {
		return session.Session{}, err
	}
	return a.chat.Restart(opts)
}

func (a *App) StopChatRoom() error {
	return a.chat.Stop()
}
```

Add `"encoding/json"` to `app.go` imports if it is not already there.

Generate bindings. If `wails` is not on `PATH`:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
```

Then:

```bash
wails generate module
```

Confirm `frontend/wailsjs/go/main/App.d.ts` contains:

```ts
export function StartChatRoom(): Promise<session.Session>;
export function ConnectChatPeer(arg1: string): Promise<void>;
export function SendChatText(arg1: string): Promise<void>;
export function RestartChatRoom(arg1: string): Promise<session.Session>;
export function StopChatRoom(): Promise<void>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/store/ ./ -count=1 -run 'TestCreateStoresPrivateKey|TestChatRoomEcho|TestStartPipeServe'`

Expected: PASS. Existing `CreateKey` callers still receive a non-empty address.

- [ ] **Step 5: Commit**

```bash
git add internal/store/keys.go internal/store/keys_test.go app.go app_test.go frontend/wailsjs
git commit -m "feat: bind chat room methods for Wails"
```

---

### Task 6: 浏览器假房间与中英文字符串

**Files:**
- Create: `frontend/src/lib/chatBrowser.ts`
- Create: `frontend/src/lib/chatBrowser.test.ts`
- Create: `frontend/src/lib/chatText.ts`
- Create: `frontend/src/lib/chatText.test.ts`
- Create: `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (test script and devDependencies)
- Modify: `frontend/src/lib/wails.ts`
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/i18n/zh-CN.ts`
- Modify: `frontend/src/i18n/locale.ts`

**Interfaces:**
- Consumes: generated `StartChatRoom`, `ConnectChatPeer`, `SendChatText`, `RestartChatRoom`, `StopChatRoom`.
- Produces:

```ts
export type BrowserMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: "text" | "system";
  code?: string;
  body: string;
  at: string;
};

export function createBrowserHub(): {
  start(sessionID: string, keyJSON: string): Promise<{ address: string }>;
  connect(addr: string): Promise<void>;
  sendText(body: string): Promise<void>;
  restart(sessionID: string, keyJSON: string): Promise<{ address: string }>;
  stop(): void;
  onEvent(cb: (ev: { Kind: string; Data?: string; Address?: string; SessionID: string }) => void): () => void;
};

export function systemText(code: string | undefined, body: string, t: (key: MessageKey) => string): string
export function localizeChatError(message: string, t: (key: MessageKey) => string): string

export function hasWailsBindings(): boolean // true only when StartChatRoom is a function
export function startChatRoom(): Promise<Session>
export function connectChatPeer(addr: string): Promise<void>
export function sendChatText(body: string): Promise<void>
export function restartChatRoom(keyName: string): Promise<Session>
export function stopChatRoom(): Promise<void>
```

`hasWailsBindings` must not use `StartPipeServe`. The in-browser path is taken when that function is missing.

New catalog keys (English value is the spec string; 简体中文 is the product copy). `chatHearMeow` is the same English in both files. `chatIgnoredPort1` is the log token `ignored port 1 stream` in both files.

| Key | en | zh-CN |
| --- | --- | --- |
| `brandName` | Tailcat Box | 猫砂盆 |
| `navChat` | Chat | 聊天 |
| `chatListening` | Listening | 正在监听 |
| `chatCopyHelper` | Anyone with this address can send to this room while it is open. | 房间开着时，拿到这个地址的人都能往这里发消息。 |
| `chatPeerLabel` | Peer | 对方 |
| `chatPeerHelper` | Paste the other person’s Tailcat address. | 把对方的 Tailcat 地址粘贴到这里。 |
| `chatConnect` | Connect | 连接 |
| `chatEmptyLede` | Messages stay on this device until you quit. | 消息只留在这台设备上，退出后就没了。 |
| `chatYou` | You | 我 |
| `chatPeerName` | Peer | 对方 |
| `chatPeerChanged` | Peer changed | 已更换对方 |
| `chatPeerConnected` | Peer connected | 对方已连接 |
| `chatHearMeow` | they're hear meow | they're hear meow |
| `chatRetry` | Retry | 重试 |
| `chatMessageLabel` | Message | 消息 |
| `chatAddrError` | Paste a Tailcat address that starts with tc. | 请粘贴以 tc 开头的 Tailcat 地址。 |
| `chatUnreachable` | Could not reach peer. Check the address and that they are online. | 连不上对方。请检查地址，并确认对方在线。 |
| `chatBadFrame` | Could not read a message. | 有一条消息读不出来。 |
| `chatRoomRestarted` | Room restarted. Send the new address. | 房间已重启。把新地址发给对方。 |
| `chatRestartRoom` | Restart room | 重启房间 |
| `chatRestartHint` | Restart room to apply | 重启房间后才会生效 |
| `chatNewRoomKey` | New room key | 新的房间密钥 |
| `chatRoomKey` | Room key | 房间密钥 |
| `keysDERPTitle` | Keys & DERP | 密钥和 DERP |
| `diagnosticsSection` | Diagnostics | 诊断 |
| `chatSession` | Chat session | 聊天会话 |
| `kindChat` | Chat | 聊天 |
| `chatIgnoredPort1` | ignored port 1 stream | ignored port 1 stream |

`chatPeerHelper` uses U+2019 in `person’s`, matching the spec. Update `settingsLede` to mention keys and diagnostics:

- en: `Appearance, language, keys, and diagnostics.`
- zh-CN: `改外观和语言，管理密钥，查看诊断。`

- [ ] **Step 1: Write the failing tests**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

Create `frontend/src/lib/chatBrowser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createBrowserHub } from "./chatBrowser";

describe("browser hub", () => {
  it("starts once, echoes text, and restarts onto a saved key", async () => {
    const hub = createBrowserHub();
    const first = await hub.start("sess-1", "");
    const second = await hub.start("sess-2", "");
    expect(second.address).toBe(first.address);
    expect(first.address.startsWith("tc:fake-room-")).toBe(true);
    await expect(hub.connect("nope")).rejects.toThrow("Paste a Tailcat address that starts with tc.");
    await hub.connect("tc:fake-echo");
    const events: Array<{ Kind: string; Data?: string }> = [];
    hub.onEvent((ev) => events.push(ev));
    await hub.sendText("hi");
    const bodies = events.filter((ev) => ev.Kind === "message").map((ev) => JSON.parse(ev.Data ?? "{}") as { body: string; direction: string });
    expect(bodies).toEqual([
      expect.objectContaining({ direction: "out", body: "hi" }),
      expect.objectContaining({ direction: "in", body: "echo" }),
    ]);
    const restarted = await hub.restart("sess-3", `{"fake":"k1"}`);
    expect(restarted.address.startsWith("tc:fake-room-key-")).toBe(true);
    expect(restarted.address).not.toBe(first.address);
    const same = await hub.restart("sess-4", `{"fake":"k1"}`);
    expect(same.address).toBe(restarted.address);
  });
});
```

Create `frontend/src/lib/chatText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/locale";
import { localizeChatError, systemText } from "./chatText";

describe("chat text", () => {
  it("keeps they're hear meow in zh-CN and translates peer changed", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("zh-CN", key);
    expect(systemText("hear-meow", "they're hear meow", t)).toBe("they're hear meow");
    expect(systemText("peer-changed", "Peer changed", t)).toBe("已更换对方");
    expect(localizeChatError("Paste a Tailcat address that starts with tc.", t)).toBe("请粘贴以 tc 开头的 Tailcat 地址。");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm install -D vitest@3 happy-dom@17 @testing-library/react@16 @testing-library/dom@10 @testing-library/user-event@14
```

Add `"test": "vitest run"` to `frontend/package.json` scripts.

Run: `cd frontend && npm test -- src/lib/chatBrowser.test.ts src/lib/chatText.test.ts`

Expected: FAIL with cannot find module `./chatBrowser` or `./chatText`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/chatBrowser.ts`:

```ts
export type BrowserMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: "text" | "system";
  code?: string;
  body: string;
  at: string;
};

type Listener = (ev: { Kind: string; Data?: string; Address?: string; SessionID: string }) => void;

function id(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function addressFor(sessionID: string, keyJSON: string): Promise<string> {
  if (!keyJSON.trim()) {
    return "tc:fake-room-" + sessionID;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyJSON));
  const hex = Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
  return "tc:fake-room-key-" + hex;
}

function message(direction: BrowserMessage["direction"], type: BrowserMessage["type"], body: string, code?: string): BrowserMessage {
  return { id: id(), direction, type, code, body, at: new Date().toISOString() };
}

export function createBrowserHub() {
  let sessionID = "";
  let address = "";
  let peer = "";
  let running = false;
  const listeners = new Set<Listener>();

  function emit(ev: { Kind: string; Data?: string; Address?: string; SessionID: string }) {
    for (const listener of listeners) {
      listener(ev);
    }
  }

  async function open(nextID: string, keyJSON: string, restarted: boolean): Promise<{ address: string }> {
    sessionID = nextID;
    address = await addressFor(nextID, keyJSON);
    peer = "";
    running = true;
    emit({ Kind: "room-ready", SessionID: sessionID, Address: address, Data: JSON.stringify({ address }) });
    if (restarted) {
      const msg = message("system", "system", "Room restarted. Send the new address.", "room-restarted");
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(msg) });
      emit({ Kind: "peer", SessionID: sessionID, Data: JSON.stringify({ address: "" }) });
    }
    return { address };
  }

  return {
    start(nextID: string, keyJSON: string) {
      if (running && address) {
        return Promise.resolve({ address });
      }
      return open(nextID, keyJSON, false);
    },
    restart(nextID: string, keyJSON: string) {
      running = false;
      peer = "";
      return open(nextID, keyJSON, true);
    },
    async connect(addr: string) {
      const trimmed = addr.trim();
      if (!trimmed.startsWith("tc")) {
        throw new Error("Paste a Tailcat address that starts with tc.");
      }
      if (!running) {
        throw new Error("room is not listening");
      }
      if (trimmed !== "tc:fake-echo" && !trimmed.startsWith("tc:fake-room-")) {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      peer = trimmed;
      emit({ Kind: "peer", SessionID: sessionID, Data: JSON.stringify({ address: peer }) });
    },
    async sendText(body: string) {
      if (!body.trim()) {
        return;
      }
      if (!peer) {
        throw new Error("no peer");
      }
      if (peer !== "tc:fake-echo") {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      const out = message("out", "text", body);
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(out) });
      const inbound = message("in", "text", "echo");
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(inbound) });
    },
    stop() {
      running = false;
      peer = "";
    },
    onEvent(cb: Listener) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
```

Create `frontend/src/lib/chatText.ts`:

```ts
import type { MessageKey } from "../i18n/en";

export function systemText(code: string | undefined, body: string, t: (key: MessageKey) => string): string {
  switch (code) {
    case "hear-meow":
      return "they're hear meow";
    case "peer-changed":
      return t("chatPeerChanged");
    case "room-restarted":
      return t("chatRoomRestarted");
    case "bad-frame":
      return t("chatBadFrame");
    default:
      return body;
  }
}

export function localizeChatError(message: string, t: (key: MessageKey) => string): string {
  switch (message) {
    case "Paste a Tailcat address that starts with tc.":
      return t("chatAddrError");
    case "Could not reach peer. Check the address and that they are online.":
      return t("chatUnreachable");
    case "room is starting":
      return "";
    default:
      return message;
  }
}
```

Add the keys from the table to `en.ts` (before `} as const`) and the same keys to `zh-CN.ts`. Replace the `settingsLede` string in each file. In `locale.ts` `kindMessageKey`, add:

```ts
    case "chat":
      return "kindChat";
```

In `frontend/src/lib/wails.ts`, replace `hasWailsBindings`:

```ts
export function hasWailsBindings(): boolean {
  return typeof window !== "undefined" && typeof goWindow().go?.main?.App?.StartChatRoom === "function";
}
```

Update the `GoWindow` type so `App` includes `StartChatRoom?: unknown`.

Import the five generated functions from `../../wailsjs/go/main/App` using the same alias style as `bindStartPipeServe`. Import `createBrowserHub` from `./chatBrowser`.

Add module state:

```ts
const browserChat = createBrowserHub();
let browserChatSession: Session | null = null;
const browserKeyJSON = new Map<string, string>();
```

Inside `fakeCreateKey`, after pushing the key, set:

```ts
browserKeyJSON.set(name, JSON.stringify({ Name: name, Client: client, Region: region, Address: address, PrivateKey: { fake: name } }));
```

Add:

```ts
function emitBrowser(ev: { Kind: string; Data?: string; Address?: string; SessionID: string }): void {
  emitFake({ SessionID: ev.SessionID, Kind: ev.Kind, Address: ev.Address, Data: ev.Data });
}

async function fakeStartChatRoom(): Promise<Session> {
  if (browserChatSession && (browserChatSession.Status === "starting" || browserChatSession.Status === "running")) {
    return { ...browserChatSession };
  }
  const sess = newSess("chat");
  browserChatSession = sess;
  const off = browserChat.onEvent((ev) => {
    if (ev.Kind === "room-ready" && ev.Address && browserChatSession) {
      browserChatSession.Status = "running";
      browserChatSession.Address = ev.Address;
    }
    emitBrowser(ev);
  });
  fake.serveStops.set(sess.ID, off);
  await browserChat.start(sess.ID, "");
  return { ...sess, Address: browserChatSession.Address, Status: browserChatSession.Status };
}

async function fakeConnectChatPeer(addr: string): Promise<void> {
  await browserChat.connect(addr);
}

async function fakeSendChatText(body: string): Promise<void> {
  await browserChat.sendText(body);
}

async function fakeRestartChatRoom(keyName: string): Promise<Session> {
  if (browserChatSession) {
    browserChatSession.Status = "stopped";
    const stop = fake.serveStops.get(browserChatSession.ID);
    if (stop) {
      stop();
    }
  }
  const sess = newSess("chat");
  browserChatSession = sess;
  const off = browserChat.onEvent((ev) => {
    if (ev.Kind === "room-ready" && ev.Address && browserChatSession && browserChatSession.ID === sess.ID) {
      browserChatSession.Status = "running";
      browserChatSession.Address = ev.Address;
    }
    emitBrowser(ev);
  });
  fake.serveStops.set(sess.ID, off);
  const material = keyName ? browserKeyJSON.get(keyName) ?? "" : "";
  if (keyName && !material) {
    throw new Error("saved key is not a Tailcat private key");
  }
  await browserChat.restart(sess.ID, material);
  return { ...browserChatSession };
}

async function fakeStopChatRoom(): Promise<void> {
  browserChat.stop();
  if (!browserChatSession) {
    return;
  }
  browserChatSession.Status = "stopped";
  browserChatSession = null;
}
```

`fakeStartChatRoom` subscribes before `start`, so the synchronous `room-ready` inside `open` is observed. `createBrowserHub.start` emits before returning, and `onEvent` is registered above that call. Good.

Export wrappers:

```ts
export async function startChatRoom(): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartChatRoom());
  }
  return fakeStartChatRoom();
}

export async function connectChatPeer(addr: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindConnectChatPeer(addr);
    return;
  }
  await fakeConnectChatPeer(addr);
}

export async function sendChatText(body: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindSendChatText(body);
    return;
  }
  await fakeSendChatText(body);
}

export async function restartChatRoom(keyName: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindRestartChatRoom(keyName));
  }
  return fakeRestartChatRoom(keyName);
}

export async function stopChatRoom(): Promise<void> {
  if (hasWailsBindings()) {
    await bindStopChatRoom();
    return;
  }
  await fakeStopChatRoom();
}
```

The hub test calls `onEvent` after `connect` and before `sendText`. `sendText` emits after that subscription. Do not emit those message events before `sendText`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/chatBrowser.test.ts src/lib/chatText.test.ts && npx tsc --noEmit`

Expected: PASS. `tsc` fails if `zh-CN.ts` misses a `MessageKey`.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/lib/chatBrowser.ts frontend/src/lib/chatBrowser.test.ts frontend/src/lib/chatText.ts frontend/src/lib/chatText.test.ts frontend/src/lib/wails.ts frontend/src/i18n/en.ts frontend/src/i18n/zh-CN.ts frontend/src/i18n/locale.ts
git commit -m "feat: add chat i18n and in-browser fake"
```

---

### Task 7: 聊天壳与聊天页

**Files:**
- Create: `frontend/src/pages/ChatPage.tsx`
- Create: `frontend/src/App.chat.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles/glass.css`
- Modify: `frontend/index.html`
- Modify: `main.go`

**Interfaces:**
- Consumes: `startChatRoom`, `connectChatPeer`, `sendChatText`, `onTailcatEvent`, `hasWailsBindings`, `systemText`, `localizeChatError`, `WindowSetTitle` from `frontend/wailsjs/runtime/runtime`.
- Produces: a shell whose `.nav-btn` list is Chat then Settings, initial page Chat, and a chat page with copy, connect, transcript, and composer. No import of `ConnectPage`, `ServicesPage`, `FilesPage`, `KeysPage`, or `DiagnosticsPage`.

Cold launch calls `startChatRoom` from `App`, not from `ChatPage`, so opening Settings does not stop the room. The effect’s cleanup must not call `stopChatRoom`. A second `Start` is safe for React Strict Mode. Listen failure sets the room error and shows **Retry**. Retry calls `startChatRoom` again and does not clear messages.

Copy writes `navigator.clipboard.writeText` with the raw address, then `ClipboardSetText` if that throws. The string must not contain `#invite=` or `http`.

Connect: trim, require prefix `tc`, otherwise focus `#chat-peer` and show the localized inline error. Composer text stays. Success calls `connectChatPeer`. Send: if peer is empty, focus `#chat-peer` and keep the draft. Enter sends when the trimmed draft is non-empty. Shift+Enter inserts a newline. Empty Enter does nothing. A rejected send keeps the draft. A resolved send clears it.

Bubbles: `out` → `chatYou`, `in` → `chatPeerName`, plus local time. System rows use `systemText`. Empty transcript shows `chatEmptyLede`. Status shows `chatListening` and, when peer is non-empty, `chatPeerConnected`. Do not render attach, burn, microphone, or call controls.

`main.go` `Title` is `Tailcat Box`. The app menu submenu label is `Tailcat Box`. `index.html` `<title>` is `Tailcat Box`. `App` sets `document.title` from `brandName` and, when bindings exist, calls `WindowSetTitle`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.chat.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import ChatPage from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

describe("phase 1 chat shell", () => {
  it("opens Chat, copies the raw address, and echoes text", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();

    const nav = document.querySelectorAll(".nav-btn");
    expect(Array.from(nav).map((node) => node.textContent)).toEqual(["Chat", "Settings"]);
    expect(screen.getByRole("heading", { name: "Tailcat Box" })).toBeTruthy();

    const copy = await screen.findByRole("button", { name: "Copy" });
    await waitFor(() => {
      expect(copy.hasAttribute("disabled")).toBe(false);
    });
    await user.click(copy);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith("tc:fake-room-")).toBe(true);
    expect(copied.includes("#invite=")).toBe(false);
    expect(copied.includes("http")).toBe(false);

    await user.type(screen.getByLabelText("Peer"), "nope");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Paste a Tailcat address that starts with tc.")).toBeTruthy();

    await user.clear(screen.getByLabelText("Peer"));
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(screen.queryByText("hi")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText(copied)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach" })).toBeNull();
  });

  it("keeps the draft when send fails and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-room-missing");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "stay");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect((composer as HTMLTextAreaElement).value).toBe("stay");
    await user.click(composer);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect((composer as HTMLTextAreaElement).value).toBe("stay\n");
    await user.clear(composer);
    await user.keyboard("{Enter}");
    expect((composer as HTMLTextAreaElement).value).toBe("");
  });

  it("shows Retry for a room error", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <ChatPage address="" peer="" messages={[]} roomError="listen failed" onConnect={vi.fn()} onSend={vi.fn()} onRetry={onRetry} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("uses 聊天 and 设置 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderApp();
    const nav = document.querySelectorAll(".nav-btn");
    expect(Array.from(nav).map((node) => node.textContent)).toEqual(["聊天", "设置"]);
  });

  it("does not import toolbox pages", () => {
    const src = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    for (const name of ["ConnectPage", "ServicesPage", "FilesPage", "KeysPage", "DiagnosticsPage"]) {
      expect(src.includes(`pages/${name}`)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.chat.test.tsx`

Expected: FAIL because the nav still lists Connect / Services / Files, or `ChatPage` is missing.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/styles/glass.css`:

```css
.chat-status {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.chat-address {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}
.chat-log {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
}
.chat-bubble {
  max-width: 70%;
  padding: 10px 12px;
  border-radius: 16px;
}
.chat-bubble.out {
  align-self: flex-end;
}
.chat-bubble.in {
  align-self: flex-start;
}
.chat-system {
  text-align: center;
  opacity: 0.8;
}
.chat-bubble header {
  display: flex;
  gap: 8px;
  font-size: 12px;
  opacity: 0.75;
}
```

Set `frontend/index.html` title to `Tailcat Box`.

In `main.go`, set `Title` to `"Tailcat Box"` and the submenu label `"Tailcat"` to `"Tailcat Box"`.

Create `frontend/src/pages/ChatPage.tsx`:

```tsx
import { useRef, useState, type KeyboardEvent } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { useI18n } from "../i18n";
import { localizeChatError, systemText } from "../lib/chatText";

export type ChatMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: string;
  code?: string;
  body: string;
  at: string;
};

type Props = {
  address: string;
  peer: string;
  messages: ChatMessage[];
  roomError: string;
  onConnect: (addr: string) => Promise<void>;
  onSend: (body: string) => Promise<void>;
  onRetry: () => Promise<void>;
};

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through
  }
  await ClipboardSetText(text);
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleTimeString();
}

export default function ChatPage({ address, peer, messages, roomError, onConnect, onSend, onRetry }: Props) {
  const { t } = useI18n();
  const peerRef = useRef<HTMLInputElement>(null);
  const [draftPeer, setDraftPeer] = useState("");
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState("");

  async function connect(): Promise<void> {
    const addr = draftPeer.trim();
    if (!addr.startsWith("tc")) {
      setInline(t("chatAddrError"));
      peerRef.current?.focus();
      return;
    }
    setInline("");
    try {
      await onConnect(addr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInline(localizeChatError(message, t) || message);
      peerRef.current?.focus();
    }
  }

  async function send(): Promise<void> {
    if (!draft.trim()) {
      return;
    }
    if (!peer) {
      peerRef.current?.focus();
      return;
    }
    const body = draft;
    try {
      await onSend(body);
      setDraft("");
    } catch {
      setDraft(body);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }
    e.preventDefault();
    void send();
  }

  return (
    <section className="page">
      <div className="chat-status">
        {roomError ? <p className="err">{roomError}</p> : <p>{t("chatListening")}</p>}
        {address ? <p className="chat-address">{address}</p> : null}
        <button className="btn" type="button" disabled={!address} onClick={() => copyText(address)}>
          {t("copy")}
        </button>
        {roomError ? (
          <button className="btn" type="button" onClick={() => onRetry()}>
            {t("chatRetry")}
          </button>
        ) : null}
      </div>
      <p className="lede">{t("chatCopyHelper")}</p>
      {peer ? <p>{t("chatPeerConnected")}</p> : null}
      <div className="field">
        <label htmlFor="chat-peer">{t("chatPeerLabel")}</label>
        <input
          id="chat-peer"
          ref={peerRef}
          value={draftPeer}
          onChange={(e) => setDraftPeer(e.target.value)}
          autoComplete="off"
        />
      </div>
      <p className="lede">{t("chatPeerHelper")}</p>
      {inline ? <p className="err">{inline}</p> : null}
      <div className="row">
        <button className="btn" type="button" disabled={!address} onClick={() => connect()}>
          {t("chatConnect")}
        </button>
      </div>
      <div className="chat-log">
        {messages.length === 0 ? <p className="lede">{t("chatEmptyLede")}</p> : null}
        {messages.map((msg) =>
          msg.direction === "system" ? (
            <p key={msg.id} className="chat-system">
              {systemText(msg.code, msg.body, t)}
            </p>
          ) : (
            <article key={msg.id} className={`glass chat-bubble ${msg.direction}`}>
              <header>
                <span>{msg.direction === "out" ? t("chatYou") : t("chatPeerName")}</span>
                <time>{stamp(msg.at)}</time>
              </header>
              <p>{msg.body}</p>
            </article>
          ),
        )}
      </div>
      <div className="field">
        <label htmlFor="chat-composer">{t("chatMessageLabel")}</label>
        <textarea id="chat-composer" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} />
      </div>
      <div className="row">
        <button className="btn" type="button" onClick={() => send()}>
          {t("send")}
        </button>
      </div>
    </section>
  );
}
```

Replace `frontend/src/App.tsx` with this file. Do not import `ConnectPage`, `ServicesPage`, `FilesPage`, `KeysPage`, or `DiagnosticsPage`. Task 8 adds the Settings subsection props; this task passes `theme` and `onTheme` only.

```tsx
import { useCallback, useEffect, useState } from "react";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import { sameKeys, sameSessions } from "./lib/snapshot";
import { useI18n } from "./i18n";
import { localizeChatError } from "./lib/chatText";
import {
  connectChatPeer,
  getNetworkSettings,
  hasWailsBindings,
  listKeys,
  listSessions,
  onTailcatEvent,
  sendChatText,
  startChatRoom,
  tailcatVersion,
  type KeyInfo,
  type Session,
  type TailcatEvent,
} from "./lib/wails";
import { WindowSetTitle } from "../wailsjs/runtime/runtime";

type Page = "chat" | "settings";
type Theme = "system" | "light" | "dark";

const THEME_KEY = "tailcat-theme";

const NAV: Array<{ id: Page; labelKey: "navChat" | "navSettings" }> = [
  { id: "chat", labelKey: "navChat" },
  { id: "settings", labelKey: "navSettings" },
];

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function asMessage(data: string): ChatMessage | null {
  try {
    const msg = JSON.parse(data) as ChatMessage;
    if (!msg.id || !msg.direction) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("chat");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [events, setEvents] = useState<TailcatEvent[]>([]);
  const [region, setRegion] = useState("");
  const [derpMapURL, setDerpMapURL] = useState("");
  const [version, setVersion] = useState("");
  const [chatAddress, setChatAddress] = useState("");
  const [chatPeer, setChatPeer] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [roomError, setRoomError] = useState("");
  const fallback = !hasWailsBindings();

  const refresh = useCallback(async () => {
    try {
      const nextSessions = await listSessions();
      const nextKeys = await listKeys();
      const net = await getNetworkSettings();
      const ver = await tailcatVersion();
      setSessions((prev) => (sameSessions(prev, nextSessions) ? prev : nextSessions));
      setKeys((prev) => (sameKeys(prev, nextKeys) ? prev : nextKeys));
      setRegion((prev) => (prev === net.Region ? prev : net.Region));
      setDerpMapURL((prev) => (prev === net.DERPMapURL ? prev : net.DERPMapURL));
      setVersion((prev) => (prev === ver ? prev : ver));
    } catch {
      // Session refresh keeps the last good snapshot. Room listen errors use roomError.
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = t("brandName");
    if (hasWailsBindings()) {
      WindowSetTitle(t("brandName"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const off = onTailcatEvent((ev) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.Kind === "room-ready" && ev.Data) {
        try {
          const data = JSON.parse(ev.Data) as { address?: string };
          if (data.address) {
            setChatAddress(data.address);
            setRoomError("");
          }
        } catch {
          // ignore malformed event data
        }
      } else if (ev.Kind === "peer" && ev.Data) {
        try {
          const data = JSON.parse(ev.Data) as { address?: string };
          setChatPeer(data.address ?? "");
        } catch {
          // ignore malformed event data
        }
      } else if (ev.Kind === "message" && ev.Data) {
        const msg = asMessage(ev.Data);
        if (msg) {
          setChatMessages((prev) => (prev.some((item) => item.id === msg.id) ? prev : [...prev, msg]));
          if (msg.code === "room-restarted") {
            setChatPeer("");
          }
        }
      }
      void refresh();
    });
    const id = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await startChatRoom();
      } catch (err) {
        if (!live) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const text = localizeChatError(message, t);
        if (!text && message === "room is starting") {
          return;
        }
        setRoomError(text || message);
      }
    })();
    return () => {
      live = false;
    };
  }, [t]);

  async function retryRoom(): Promise<void> {
    setRoomError("");
    try {
      await startChatRoom();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRoomError(localizeChatError(message, t) || message);
    }
  }

  const listed = sessions.find((s) => s.Kind === "chat" && s.Status === "running");
  const address = chatAddress || listed?.Address || "";
  void keys;
  void region;
  void derpMapURL;
  void version;
  void events;

  return (
    <div className="shell">
      <aside className="glass sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>{t("brandName")}</h1>
            <p>{t("brandTagline")}</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">{fallback ? <div className="fallback-chip">{t("fallbackChip")}</div> : null}</div>
      </aside>
      <main className="glass main">
        {page === "chat" ? (
          <ChatPage
            address={address}
            peer={chatPeer}
            messages={chatMessages}
            roomError={roomError}
            onConnect={connectChatPeer}
            onSend={sendChatText}
            onRetry={retryRoom}
          />
        ) : (
          <SettingsPage theme={theme} onTheme={setTheme} />
        )}
      </main>
    </div>
  );
}
```

The `void keys` lines keep the refreshed settings data in this task so Task 8 can delete those lines and pass the values into Settings. The start-room effect is declared after the `onTailcatEvent` effect. Its cleanup does not call `stopChatRoom`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/App.chat.test.tsx && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/App.chat.test.tsx frontend/src/App.tsx frontend/src/styles/glass.css frontend/index.html main.go
git commit -m "feat: open Chat and Settings and exchange text"
```

---

### Task 8: 设置里的密钥、DERP 与诊断

**Files:**
- Create: `frontend/src/components/KeysDERPSection.tsx`
- Create: `frontend/src/components/DiagnosticsSection.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.chat.test.tsx`

**Interfaces:**
- Consumes: `createKey`, `deleteKey`, `setNetworkSettings`, `restartChatRoom`, `startPing`, `stopSession`, `KeyInfo`, `Session`, `TailcatEvent`. `SessionCard` may be imported. `KeysPage` and `DiagnosticsPage` may not.
- Produces: Settings order Appearance, Client, System, Keys & DERP, Diagnostics. Room-key `<select id="room-key">` defaults to empty (`chatNewRoomKey`). Choosing a named key, or editing region / DERP so they differ from the values captured when the room last became ready, shows `chatRestartHint`. **Restart room** calls `restartChatRoom(selectedName)`. The transcript stays. The peer line clears when a `peer` event arrives with an empty address or when a message code is `room-restarted`.

Ping input `#ping-addr` initializes from the current peer and updates when the peer changes until the user types. Diagnostics lists sessions with `Kind === "chat"` through `SessionCard` without an `onStop`. The event log shows `Kind === "data"` payloads, which includes `ignored port 1 stream`. Ping still calls `startPing`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.chat.test.tsx`:

```tsx
  it("reaches Keys & DERP and Diagnostics inside Settings", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Keys & DERP" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy();
    expect(screen.getByLabelText("Room key")).toBeTruthy();
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("tc:fake-echo");
    await user.type(screen.getByLabelText("Name"), "home");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await user.selectOptions(screen.getByLabelText("Room key"), "home");
    expect(screen.getByText("Restart room to apply")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restart room" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    await waitFor(() => {
      const shown = document.querySelector(".chat-address")?.textContent ?? "";
      expect(shown.startsWith("tc:fake-room-key-")).toBe(true);
    });
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Services" })).toBeNull();
    expect(document.querySelectorAll(".nav-btn").length).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.chat.test.tsx`

Expected: FAIL with unable to find heading `Keys & DERP`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/KeysDERPSection.tsx` with props:

```tsx
type Props = {
  keys: KeyInfo[];
  busy: boolean;
  error: string;
  region: string;
  derpMapURL: string;
  roomKey: string;
  appliedKey: string;
  appliedRegion: string;
  appliedDERP: string;
  onRoomKey: (name: string) => void;
  onCreate: (name: string, client: boolean, region: string) => void;
  onDelete: (name: string) => void;
  onSaveNetwork: (region: string, derpMapURL: string) => void;
  onRestart: (keyName: string) => void;
};
```

Render, in order: heading `keysDERPTitle`; the existing DERP form (`net-region`, `net-derp`, `saveNetwork`); the existing create-key form (`key-name`, `key-region`, client checkbox, `createKey`); the key list with copy and delete, skipping delete when `source === "cli"`; then room key:

```tsx
<label htmlFor="room-key">{t("chatRoomKey")}</label>
<select id="room-key" value={roomKey} onChange={(e) => onRoomKey(e.target.value)}>
  <option value="">{t("chatNewRoomKey")}</option>
  {keys.map((key) => (
    <option key={key.Name + key.Source} value={key.Name}>
      {key.Name}
    </option>
  ))}
</select>
```

Show `<p>{t("chatRestartHint")}</p>` when `roomKey !== appliedKey || region !== appliedRegion || derpMapURL !== appliedDERP`. Button:

```tsx
<button className="btn" type="button" disabled={busy} onClick={() => onRestart(roomKey)}>
  {t("chatRestartRoom")}
</button>
```

Copy uses `navigator.clipboard.writeText` and then `ClipboardSetText`, same as `ChatPage`. Do not render parse/resolve.

Create `frontend/src/components/DiagnosticsSection.tsx` with props `sessions`, `events`, `peer`, `busy`, `error`, `onPing`, `onStop`. Heading `diagnosticsSection`. Ping form uses `#ping-addr`. State:

```tsx
const [addr, setAddr] = useState(peer);
const [dirty, setDirty] = useState(false);
const [untilDirect, setUntilDirect] = useState(true);
useEffect(() => {
  if (!dirty) {
    setAddr(peer);
  }
}, [peer, dirty]);
```

Typing sets `dirty` true. Submit calls `onPing(addr.trim(), untilDirect)` and disables the button when `busy || !addr.trim()`. Event log joins `events.filter((ev) => ev.Kind === "data" && ev.Data).map((ev) => ev.Data)`. Chat sessions:

```tsx
sessions.filter((s) => s.Kind === "chat").map((sess) => <SessionCard key={sess.ID} session={sess} />)
```

Do not pass `onStop` to that card. Ping sessions keep `onStop`.

Extend `SettingsPage` props with the KeysDERP and Diagnostics props and render `<KeysDERPSection ... />` then `<DiagnosticsSection ... />` after the existing cards, still inside `<section className="page">`.

In `App`, delete the four `void` statements (`keys`, `region`, `derpMapURL`, `version`, and `events` — keep `events` in state; it is passed to Diagnostics). Add:

```tsx
const [roomKey, setRoomKey] = useState("");
const [appliedRoom, setAppliedRoom] = useState({ key: "", region: "", derp: "" });
const roomKeyRef = useRef("");
```

Import `useRef`. Inside the `room-ready` branch, after `setChatAddress`, call `setAppliedRoom({ key: roomKeyRef.current, region, derp: derpMapURL })`. `onRestart` sets `roomKeyRef.current = keyName` before `restartChatRoom`. The initial start leaves the ref at `""`.

Replace the settings branch with:

```tsx
<SettingsPage
  theme={theme}
  onTheme={setTheme}
  keys={keys}
  busy={false}
  error=""
  region={region}
  derpMapURL={derpMapURL}
  roomKey={roomKey}
  appliedKey={appliedRoom.key}
  appliedRegion={appliedRoom.region}
  appliedDERP={appliedRoom.derp}
  onRoomKey={(name) => {
    roomKeyRef.current = name;
    setRoomKey(name);
  }}
  sessions={sessions}
  events={events}
  peer={chatPeer}
  onCreate={(name, client, keyRegion) => void run(() => createKey(name, client, keyRegion))}
  onDelete={(name) => void run(() => deleteKey(name))}
  onSaveNetwork={(nextRegion, nextDERP) => void run(() => setNetworkSettings(nextRegion, nextDERP))}
  onRestart={(keyName) => void onRestart(keyName)}
  onPing={(addr, untilDirect) => void run(() => startPing(addr, untilDirect))}
  onStop={(id) => void run(() => stopSession(id))}
/>
```

Import `createKey`, `deleteKey`, `setNetworkSettings`, `restartChatRoom`, `startPing`, and `stopSession`. Add this helper next to `retryRoom`:

```tsx
async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    await refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setRoomError(localizeChatError(message, t) || message);
  }
}

async function onRestart(keyName: string) {
  roomKeyRef.current = keyName;
  setRoomError("");
  try {
    await restartChatRoom(keyName);
    setAppliedRoom({ key: keyName, region, derp: derpMapURL });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setRoomError(localizeChatError(message, t) || message);
  }
}
```

Do not clear `chatMessages` in `onRestart`. Clearing the peer is the `peer` event with `address: ""` from the Go service and the browser hub.

The diagnostics ping field is the only control labeled with `t("address")` (`Address` in English). Use this form so the test can read it:

```tsx
<label htmlFor="ping-addr">{t("address")}</label>
<input
  id="ping-addr"
  value={addr}
  onChange={(e) => {
    setDirty(true);
    setAddr(e.target.value);
  }}
  placeholder="tc:…"
  autoComplete="off"
/>
```

The create-key name field keeps `htmlFor="key-name"` and `t("name")`. The room-key label is `htmlFor="room-key"` and `t("chatRoomKey")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test && npx tsc --noEmit`

Expected: PASS.

Also run: `go test ./...`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/KeysDERPSection.tsx frontend/src/components/DiagnosticsSection.tsx frontend/src/pages/SettingsPage.tsx frontend/src/App.tsx frontend/src/App.chat.test.tsx
git commit -m "feat: move keys and diagnostics under Settings"
```

- [ ] **Step 6: Run the phase CI contract**

```bash
go test ./...
cd frontend && npm test && npm run build
```

Expected: all PASS, and `npm run build` prints a Vite production build without a TypeScript error.

---

## 手工互通（不进 CI）

Run Box with the real adapter (`TAILCAT_ADAPTER` unset). Run official Tailcatchat locally or on GitHub Pages.

1. Start a Tailcatchat room and copy its raw `tc…` address (the address field, not only the invite link). Connect to it from Box. Confirm the web UI shows `they're hear meow` and that text travels both ways.
2. Reverse the roles: copy Box’s address into Tailcatchat and press Set. Confirm Box shows the peer and `they're hear meow` once, with no invite parser in Box. Paste the web room address into Box and press Connect, then send text back.

Do not perform the phase 2–4 manual steps in this plan.

## 验收对照

| Phase 1 acceptance | Task |
| --- | --- |
| Sidebar is Chat and Settings only | Task 7 test |
| Cold launch opens Chat; room starts or Retry | Task 7 |
| Copy places the raw `tc…` string on the clipboard | Task 7 test |
| Connect sends hello; inbound hello sets the peer and shows `they're hear meow` once | Task 4 |
| Text both ways with Tailcatchat | Task 3 dial path + manual section |
| Paste Box’s address into Tailcatchat Set | Task 3 inbound hello + Task 4 |
| Two Boxes exchange text after one Connect | Task 4 `TestHelloOnceAndTextBothWays` |
| Keys & DERP and Diagnostics inside Settings; Restart room applies a saved key and changes the address | Task 5 app test + Task 8 |
| Toolbox screens are not mounted | Task 7 source assertion |
| English and zh-CN for the new chrome | Task 6 |
| `TAILCAT_ADAPTER=fake` covers room, hello, and text with no network | Tasks 2, 4, 5 |
| Phase 1 hello omits `caps` | Task 1 and Task 4 `TestConnectHelloOmitsCaps` |
| 64 KiB half-close | Task 3 |
| Port 1 diagnostic, bad frame, unknown type ignored | Task 4 |
| Transcript kept across Restart room; peer cleared | Task 4 and Task 5 |
| No files, burn, voice, WebRTC, invite URL, or toolbox return | 范围之外; Task 7 asserts no Attach control and copy rejects `#invite=` |

## 自检

Spec coverage for phase 1 is the table above. This plan does not leave a phase 1 acceptance line without a task.

Placeholder scan: tasks name files, signatures, commands, and the expected FAIL/PASS text. They do not say TBD, TODO, or “similar to task N”.

Type consistency: `StartChatRoom`, `ConnectChatPeer`, `SendChatText`, `RestartChatRoom`, and `StopChatRoom` are the Wails names. `ChatAdapter.StartRoom` returns a `Room` whose `SendEnvelope` takes a packed frame. `chat.Start` / `Connect` / `SendText` / `Restart` / `Stop` are the Go service names. Message `code` values are `hear-meow`, `peer-changed`, `room-restarted`, and `bad-frame` in Go, the browser hub, and `systemText`.
