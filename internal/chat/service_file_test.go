package chat

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func waitCaps(t *testing.T, svc *Service, cap string) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for !hasCap(svc.PeerCaps(), cap) {
		select {
		case <-deadline:
			t.Fatalf("caps=%v", svc.PeerCaps())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func waitFile(t *testing.T, svc *Service, direction, name string) Message {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		for _, msg := range svc.Messages() {
			if msg.Direction == direction && msg.Type == "file" && msg.Name == name {
				return msg
			}
		}
		select {
		case <-deadline:
			t.Fatalf("messages=%+v", svc.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func waitTransfer(t *testing.T, svc *Service, id, status string) Transfer {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		for _, tr := range svc.Transfers() {
			if tr.ID == id && tr.Status == status {
				return tr
			}
		}
		select {
		case <-deadline:
			t.Fatalf("transfers=%+v", svc.Transfers())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func writeTemp(t *testing.T, name string, body []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOfficialFileIsOneEnvelope(t *testing.T) {
	fake := adapter.NewFake()
	svc := New(fake)
	svc.SetDataDir(t.TempDir())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:fake-official"); err != nil {
		t.Fatal(err)
	}
	body := []byte("hello-official")
	path := writeTemp(t, "note.txt", body)
	if _, err := svc.SendFile(path, true, 5); err != nil {
		t.Fatal(err)
	}
	msg := waitFile(t, svc, "out", "note.txt")
	if !msg.Burn || msg.TTLSec != 5 {
		t.Fatalf("%+v", msg)
	}
	tr := waitTransfer(t, svc, msg.FileID, statusDone)
	if tr.Mode != modeFull {
		t.Fatalf("mode=%s", tr.Mode)
	}
	var files, chunks, begins int
	for _, frame := range fake.FramesTo("tc:fake-official") {
		meta, payload, err := Unpack(frame.Frame)
		if err != nil {
			t.Fatal(err)
		}
		switch meta["type"] {
		case "file":
			files++
			if meta["name"] != "note.txt" || string(payload) != string(body) || meta["burn"] != true {
				t.Fatalf("meta=%v payload=%q", meta, payload)
			}
		case "file-chunk":
			chunks++
		case "file-begin":
			begins++
		}
	}
	if files != 1 || chunks != 0 || begins != 0 {
		t.Fatalf("files=%d chunks=%d begins=%d", files, chunks, begins)
	}
}

func TestResumeRetriesFromStoredPrefix(t *testing.T) {
	old := fileChunkSize
	fileChunkSize = 32
	t.Cleanup(func() { fileChunkSize = old })

	fake := adapter.NewFake()
	svc := New(fake)
	svc.SetDataDir(t.TempDir())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:fake-resume"); err != nil {
		t.Fatal(err)
	}
	waitCaps(t, svc, "resume")
	body := make([]byte, 40)
	for i := range body {
		body[i] = byte(i + 1)
	}
	path := writeTemp(t, "blob.bin", body)
	if _, err := svc.SendFile(path, false, 0); err != nil {
		t.Fatal(err)
	}
	msg := waitFile(t, svc, "out", "blob.bin")
	tr := waitTransfer(t, svc, msg.FileID, statusDone)
	if tr.Mode != modeResume || tr.Offset != int64(len(body)) {
		t.Fatalf("%+v", tr)
	}
	var chunkOffsets []int64
	for _, frame := range fake.FramesTo("tc:fake-resume") {
		meta, _, err := Unpack(frame.Frame)
		if err != nil {
			t.Fatal(err)
		}
		if meta["type"] == "file-chunk" {
			chunkOffsets = append(chunkOffsets, asInt(meta["offset"]))
		}
		if meta["type"] == "file" {
			t.Fatal("resume peer received a full file envelope")
		}
	}
	if len(chunkOffsets) != 2 || chunkOffsets[0] != 0 || chunkOffsets[1] != 32 {
		t.Fatalf("offsets=%v", chunkOffsets)
	}
}

func TestBoxHelloAdvertisesBurnAndResume(t *testing.T) {
	fake := adapter.NewFake()
	svc := New(fake)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:fake-box"); err != nil {
		t.Fatal(err)
	}
	waitCaps(t, svc, "burn")
	waitCaps(t, svc, "resume")
}

func TestTwoBoxesResumeASmallFile(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	a.SetDataDir(t.TempDir())
	b.SetDataDir(t.TempDir())
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
	for b.Peer() != readyA.Address || !hasCap(b.PeerCaps(), "resume") {
		select {
		case <-deadline:
			t.Fatalf("peer=%s caps=%v", b.Peer(), b.PeerCaps())
		case <-time.After(10 * time.Millisecond):
		}
	}
	body := []byte("png-bytes")
	path := writeTemp(t, "pic.png", body)
	if _, err := b.SendFile(path, false, 0); err != nil {
		t.Fatal(err)
	}
	msg := waitFile(t, a, "in", "pic.png")
	if msg.Mime != "image/png" || msg.Preview == "" {
		t.Fatalf("%+v", msg)
	}
	got, err := os.ReadFile(msg.Path)
	if err != nil || string(got) != string(body) {
		t.Fatalf("got=%q err=%v", got, err)
	}
	if err := a.Discard(msg.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(msg.Path); !os.IsNotExist(err) {
		t.Fatal("inbox file survived discard")
	}
	for _, left := range a.Messages() {
		if left.ID == msg.ID {
			t.Fatal("message survived discard")
		}
	}
}

func TestBurnTextStaysOnTheWire(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	if _, err := a.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	readyB := waitRunning(t, b)
	_ = waitRunning(t, a)
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	if err := a.SendTextBurn("secret", true, 99); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	var inbound Message
	for inbound.ID == "" {
		for _, msg := range b.Messages() {
			if msg.Direction == "in" && msg.Type == "text" {
				inbound = msg
			}
		}
		select {
		case <-deadline:
			t.Fatalf("%+v", b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if inbound.Body != "secret" || !inbound.Burn || inbound.TTLSec != 30 {
		t.Fatalf("%+v", inbound)
	}
	var out Message
	for _, msg := range a.Messages() {
		if msg.Direction == "out" && msg.Body == "secret" {
			out = msg
		}
	}
	if !out.Burn || out.TTLSec != 30 {
		t.Fatalf("sender=%+v", out)
	}
}

func TestResumeTimeoutFallsBackToFullFile(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	svc.offsetWaitFor = 30 * time.Millisecond
	svc.SetDataDir(t.TempDir())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:peer"); err != nil {
		t.Fatal(err)
	}
	mem.push(adapter.ChatEvent{
		Kind: adapter.ChatEventInbound,
		Port: portControl,
		Data: mustPack(t, map[string]any{"type": "hello", "replyTo": "tc:peer", "caps": []string{"resume"}}, nil),
	})
	waitCaps(t, svc, "resume")
	path := writeTemp(t, "late.txt", []byte("late"))
	if _, err := svc.SendFile(path, false, 0); err != nil {
		t.Fatal(err)
	}
	msg := waitFile(t, svc, "out", "late.txt")
	tr := waitTransfer(t, svc, msg.FileID, statusDone)
	if tr.Mode != modeFull {
		t.Fatalf("%+v", tr)
	}
	var begin, file, chunk int
	mem.mu.Lock()
	sent := append([]sentFrame(nil), mem.sent...)
	mem.mu.Unlock()
	for _, frame := range sent {
		meta, _, err := Unpack(frame.frame)
		if err != nil {
			t.Fatal(err)
		}
		switch meta["type"] {
		case "file-begin":
			begin++
		case "file":
			file++
		case "file-chunk":
			chunk++
		}
	}
	if begin != 1 || file != 1 || chunk != 0 {
		t.Fatalf("begin=%d file=%d chunk=%d", begin, file, chunk)
	}
}

func TestHashMismatchDeletesPartial(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	dir := t.TempDir()
	svc.SetDataDir(dir)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	id := "11111111-1111-4111-8111-111111111111"
	mem.push(adapter.ChatEvent{
		Kind: adapter.ChatEventInbound,
		Port: portFiles,
		Data: mustPack(t, map[string]any{
			"type":   "file-chunk",
			"id":     id,
			"name":   "dir/report.pdf",
			"mime":   "application/pdf",
			"size":   5,
			"sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"offset": 0,
		}, []byte("hello")),
	})
	deadline := time.After(2 * time.Second)
	for countCode(svc, "file-verify") != 1 {
		select {
		case <-deadline:
			t.Fatalf("%+v", svc.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	partial := filepath.Join(dir, partialDirName, id)
	if _, err := os.Stat(partial); !os.IsNotExist(err) {
		t.Fatal("partial survived mismatch")
	}
	for _, msg := range svc.Messages() {
		if msg.Type == "file" {
			t.Fatal("mismatch became a file message")
		}
	}
}

func TestWholeFileStripsDirectories(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	dir := t.TempDir()
	svc.SetDataDir(dir)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	mem.push(adapter.ChatEvent{
		Kind: adapter.ChatEventInbound,
		Port: portFiles,
		Data: mustPack(t, map[string]any{"type": "file", "name": `..\secret\photo.png`, "mime": "image/png"}, []byte("img")),
	})
	msg := waitFile(t, svc, "in", "photo.png")
	if msg.Mime != "image/png" || msg.Preview == "" {
		t.Fatalf("%+v", msg)
	}
	if _, err := os.Stat(msg.Path); err != nil {
		t.Fatal(err)
	}
}

func TestOneDeepQueueReplaces(t *testing.T) {
	mem := newMemAdapter()
	mem.gate = make(chan struct{})
	svc := New(mem)
	svc.SetDataDir(t.TempDir())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:peer"); err != nil {
		t.Fatal(err)
	}
	first := writeTemp(t, "a.txt", []byte("a"))
	second := writeTemp(t, "b.txt", []byte("b"))
	third := writeTemp(t, "c.txt", []byte("c"))
	if status, err := svc.SendFile(first, false, 0); err != nil || status != "" {
		t.Fatalf("status=%q err=%v", status, err)
	}
	deadline := time.After(2 * time.Second)
	for len(svc.Transfers()) == 0 {
		select {
		case <-deadline:
			t.Fatal("transfer did not start")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if status, err := svc.SendFile(second, false, 0); err != nil || status != "" {
		t.Fatalf("queue status=%q err=%v", status, err)
	}
	status, err := svc.SendFile(third, false, 0)
	if err != nil || status != "replaced" {
		t.Fatalf("status=%q err=%v", status, err)
	}
	close(mem.gate)
	waitFile(t, svc, "out", "a.txt")
	waitFile(t, svc, "out", "c.txt")
	for _, msg := range svc.Messages() {
		if msg.Name == "b.txt" {
			t.Fatal("queued file was not replaced")
		}
	}
}
