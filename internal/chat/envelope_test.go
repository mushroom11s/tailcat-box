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
