package chat

import (
	"encoding/json"
	"fmt"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func (s *Service) SendSignal(metaJSON string) error {
	meta, err := parseSignal(metaJSON)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.peer == "" || s.room == nil || s.sess == nil {
		s.mu.Unlock()
		return fmt.Errorf("no peer")
	}
	room := s.room
	s.mu.Unlock()
	delete(meta, "v")
	frame, err := Pack(meta, nil)
	if err != nil {
		return err
	}
	if err := s.dial(s.transferContext(), room, portControl, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	return nil
}

func (s *Service) emitControl(sessionID string, frame []byte) {
	raw, ok := RawMeta(frame)
	if !ok || len(raw) == 0 {
		return
	}
	s.emit(adapter.Event{SessionID: sessionID, Kind: "signal", Data: string(raw)})
}

func parseSignal(metaJSON string) (map[string]any, error) {
	var meta map[string]any
	if err := json.Unmarshal([]byte(metaJSON), &meta); err != nil || meta == nil {
		return nil, fmt.Errorf("invalid signal")
	}
	switch meta["type"] {
	case "rtc-offer":
		mode, _ := meta["mode"].(string)
		if mode != "voice" && mode != "video" && mode != "screen" {
			return nil, fmt.Errorf("invalid signal")
		}
		if !validDescription(meta["description"]) {
			return nil, fmt.Errorf("invalid signal")
		}
	case "rtc-answer":
		if !validDescription(meta["description"]) {
			return nil, fmt.Errorf("invalid signal")
		}
	case "rtc-hangup":
	default:
		return nil, fmt.Errorf("invalid signal")
	}
	return meta, nil
}

func validDescription(v any) bool {
	desc, ok := v.(map[string]any)
	if !ok {
		return false
	}
	typ, _ := desc["type"].(string)
	sdp, _ := desc["sdp"].(string)
	return typ != "" && sdp != ""
}
