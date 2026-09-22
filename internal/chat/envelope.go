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

// RawMeta returns the JSON object inside a TCH1 frame without decoding it.
func RawMeta(frame []byte) ([]byte, bool) {
	if len(frame) < 8 || string(frame[:4]) != "TCH1" {
		return nil, false
	}
	n := binary.BigEndian.Uint32(frame[4:8])
	if uint64(n) > uint64(len(frame)-8) {
		return nil, false
	}
	return frame[8 : 8+int(n)], true
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
