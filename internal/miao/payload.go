package miao

import (
	"encoding/json"
	"errors"
	"strings"
)

var ErrBadCode = errors.New("That share code is not valid.")

// JoinPayload is the QR and copyable token. Peers need both the Tailcat address and the share token.
type JoinPayload struct {
	V     int    `json:"v"`
	Kind  string `json:"kind"`
	Addr  string `json:"addr"`
	Token string `json:"token"`
}

func EncodeJoin(addr, token string) (string, error) {
	payload := JoinPayload{V: 1, Kind: "miao", Addr: strings.TrimSpace(addr), Token: strings.TrimSpace(token)}
	if err := payload.validate(); err != nil {
		return "", err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func ParseJoin(raw string) (JoinPayload, error) {
	var payload JoinPayload
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload); err != nil {
		return JoinPayload{}, ErrBadCode
	}
	if err := payload.validate(); err != nil {
		return JoinPayload{}, ErrBadCode
	}
	return payload, nil
}

func (p JoinPayload) validate() error {
	if p.V != 1 || p.Kind != "miao" || !strings.HasPrefix(p.Addr, "tc") || strings.TrimSpace(p.Token) == "" {
		return ErrBadCode
	}
	return nil
}
