package chat

import (
	"encoding/binary"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func sinePCM(rate int, seconds float64) []byte {
	n := int(float64(rate) * seconds)
	out := make([]byte, n*2)
	for i := 0; i < n; i++ {
		sample := math.Sin(2 * math.Pi * 440 * float64(i) / float64(rate))
		binary.LittleEndian.PutUint16(out[i*2:], uint16(int16(sample*12000)))
	}
	return out
}

func TestTranscodePCMToWebMOpusRoundTrip(t *testing.T) {
	pcm := sinePCM(48000, 0.4)
	mime, payload, err := TranscodeVoice("audio/pcm;rate=48000;channels=1", pcm)
	if err != nil {
		t.Fatal(err)
	}
	if mime != voiceMIME {
		t.Fatalf("mime=%s", mime)
	}
	if !strings.Contains(string(payload), "A_OPUS") || !strings.Contains(string(payload), "OpusHead") {
		t.Fatal("payload is not WebM Opus")
	}
	wav, err := DecodeVoiceWAV(mime, payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatalf("wav header %q", wav[:12])
	}
	decoded := wavPCM(t, wav)
	if corr := bestCorrelation(decoded, pcmInt16(pcm), 2000); corr < 0.5 {
		t.Fatalf("correlation=%f", corr)
	}
}

func TestTranscodePassesThroughWebMOpus(t *testing.T) {
	pcm := sinePCM(16000, 0.3)
	mime, payload, err := TranscodeVoice("audio/pcm;rate=16000;channels=1", pcm)
	if err != nil {
		t.Fatal(err)
	}
	again, same, err := TranscodeVoice(mime, payload)
	if err != nil {
		t.Fatal(err)
	}
	if again != voiceMIME || string(same) != string(payload) {
		t.Fatalf("passthrough mime=%s changed=%v", again, string(same) != string(payload))
	}
}

func TestDecodeFFmpegWebMOpus(t *testing.T) {
	raw, err := os.ReadFile("testdata/opus-tone.webm")
	if err != nil {
		t.Fatal(err)
	}
	wav, err := DecodeVoiceWAV("audio/webm;codecs=opus", raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(wav[:4]) != "RIFF" {
		t.Fatalf("wav %q", wav[:4])
	}
	if corr := bestCorrelation(wavPCM(t, wav), pcmInt16(sinePCM(48000, 0.4)), 4000); corr < 0.4 {
		t.Fatalf("correlation=%f", corr)
	}
}

func TestDecodeVoiceRejectsGarbage(t *testing.T) {
	if _, err := DecodeVoiceWAV("audio/webm;codecs=opus", []byte("nope")); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestSendVoicePort103AndFakeReceive(t *testing.T) {
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
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	pcm := sinePCM(48000, 0.25)
	if err := a.SendVoice("audio/pcm;rate=48000;channels=1", 0, pcm, true, 5); err != nil {
		t.Fatal(err)
	}
	frames := fake.FramesTo(readyB.Address)
	var voice []byte
	for _, frame := range frames {
		if frame.Port == portVoice {
			voice = frame.Frame
		}
	}
	if voice == nil {
		t.Fatalf("no port 103 frame in %+v", frames)
	}
	meta, payload, err := Unpack(voice)
	if err != nil {
		t.Fatal(err)
	}
	if meta["type"] != "voice" || meta["mime"] != voiceMIME || meta["duration"].(float64) != 1 {
		t.Fatalf("meta=%v", meta)
	}
	if meta["burn"] != true || meta["ttlSec"].(float64) != 5 {
		t.Fatalf("burn=%v", meta)
	}
	if _, err := DecodeVoiceWAV(voiceMIME, payload); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for !hasVoice(b, "in", voiceMIME) {
		select {
		case <-deadline:
			t.Fatalf("b=%+v", b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	msg := voiceMessage(t, b, "in")
	if !msg.Burn || msg.TTLSec != 5 || msg.Duration != 1 || msg.Audio == "" {
		t.Fatalf("%+v", msg)
	}
	out := voiceMessage(t, a, "out")
	if out.Mime != voiceMIME || !out.Burn || out.Duration != 1 {
		t.Fatalf("out=%+v", out)
	}
}

func TestOfficialPeerAcceptsVoice(t *testing.T) {
	fake := adapter.NewFake()
	svc := New(fake)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:fake-official"); err != nil {
		t.Fatal(err)
	}
	webm := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x02}
	if err := svc.SendVoice(voiceMIME, 3, webm, false, 0); err != nil {
		t.Fatal(err)
	}
	frames := fake.FramesTo("tc:fake-official")
	var found bool
	for _, frame := range frames {
		if frame.Port != portVoice {
			continue
		}
		meta, payload, err := Unpack(frame.Frame)
		if err != nil {
			t.Fatal(err)
		}
		if meta["type"] != "voice" || meta["duration"].(float64) != 3 || string(payload) != string(webm) {
			t.Fatalf("meta=%v", meta)
		}
		if _, ok := meta["burn"]; ok {
			t.Fatal("burn set on a normal voice note")
		}
		found = true
	}
	if !found {
		t.Fatal("official peer did not capture voice")
	}
	if hasVoice(svc, "in", voiceMIME) {
		t.Fatal("official peer answered")
	}
}

func TestEmptyVoiceDoesNotSend(t *testing.T) {
	fake := adapter.NewFake()
	svc := New(fake)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:fake-official"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendVoice(voiceMIME, 1, nil, false, 0); err != nil {
		t.Fatal(err)
	}
	for _, frame := range fake.FramesTo("tc:fake-official") {
		if frame.Port == portVoice {
			t.Fatal("empty voice was sent")
		}
	}
}

func hasVoice(svc *Service, direction, mime string) bool {
	for _, msg := range svc.Messages() {
		if msg.Direction == direction && msg.Type == "voice" && msg.Mime == mime {
			return true
		}
	}
	return false
}

func voiceMessage(t *testing.T, svc *Service, direction string) Message {
	t.Helper()
	for _, msg := range svc.Messages() {
		if msg.Direction == direction && msg.Type == "voice" {
			return msg
		}
	}
	t.Fatalf("missing %s voice in %+v", direction, svc.Messages())
	return Message{}
}

func pcmInt16(b []byte) []int16 {
	out := make([]int16, len(b)/2)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(b[i*2:]))
	}
	return out
}

func wavPCM(t *testing.T, wav []byte) []int16 {
	t.Helper()
	if len(wav) < 44 {
		t.Fatalf("short wav %d", len(wav))
	}
	return pcmInt16(wav[44:])
}

func bestCorrelation(got, want []int16, window int) float64 {
	if len(got) == 0 || len(want) == 0 {
		return 0
	}
	best := -1.0
	for lag := -window; lag <= window; lag++ {
		var sum, e1, e2 float64
		n := 0
		for i := 0; i < len(want); i++ {
			j := i + lag
			if j < 0 || j >= len(got) {
				continue
			}
			a := float64(got[j])
			b := float64(want[i])
			sum += a * b
			e1 += a * a
			e2 += b * b
			n++
		}
		if n < 1000 || e1 == 0 || e2 == 0 {
			continue
		}
		c := sum / math.Sqrt(e1*e2)
		if c > best {
			best = c
		}
	}
	return best
}
