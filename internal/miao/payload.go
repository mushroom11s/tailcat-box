package miao

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

var ErrBadCode = errors.New("That share code is not valid.")

const shareCodePrefix = "mw1."

// JoinPayload is the QR and copyable token. Peers need both the Tailcat address and the share token.
type JoinPayload struct {
	V     int    `json:"v"`
	Kind  string `json:"kind"`
	Addr  string `json:"addr"`
	Token string `json:"token"`
}

// EncodeJoin writes the outward share code: "mw1." plus unpadded base64url.
// The prefix implies v=1 and kind=miao. The binary is the address and token only.
// A canonical Tailcat address (tc + base64url) is stored as its raw bytes.
func EncodeJoin(addr, token string) (string, error) {
	payload := JoinPayload{V: 1, Kind: "miao", Addr: strings.TrimSpace(addr), Token: strings.TrimSpace(token)}
	if err := payload.validate(); err != nil {
		return "", err
	}
	body, err := packShare(payload.Addr, payload.Token)
	if err != nil {
		return "", err
	}
	return shareCodePrefix + base64.RawURLEncoding.EncodeToString(body), nil
}

// ParseJoin accepts a mw1. code and the legacy JSON
// {"v":1,"kind":"miao","addr":"…","token":"…"}.
func ParseJoin(raw string) (JoinPayload, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, shareCodePrefix) {
		return parseCompact(raw)
	}
	return parseLegacy(raw)
}

func parseLegacy(raw string) (JoinPayload, error) {
	var payload JoinPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return JoinPayload{}, ErrBadCode
	}
	if err := payload.validate(); err != nil {
		return JoinPayload{}, ErrBadCode
	}
	return payload, nil
}

func parseCompact(raw string) (JoinPayload, error) {
	encoded := strings.TrimPrefix(raw, shareCodePrefix)
	if encoded == "" {
		return JoinPayload{}, ErrBadCode
	}
	buf, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(buf) < 5 {
		return JoinPayload{}, ErrBadCode
	}
	kind := buf[0]
	buf = buf[1:]
	addrBody, buf, ok := takeField(buf)
	if !ok {
		return JoinPayload{}, ErrBadCode
	}
	tokenBody, buf, ok := takeField(buf)
	if !ok || len(buf) != 0 || !utf8.Valid(tokenBody) {
		return JoinPayload{}, ErrBadCode
	}
	addr, ok := unpackAddr(kind, addrBody)
	if !ok {
		return JoinPayload{}, ErrBadCode
	}
	payload := JoinPayload{V: 1, Kind: "miao", Addr: addr, Token: string(tokenBody)}
	if err := payload.validate(); err != nil {
		return JoinPayload{}, ErrBadCode
	}
	return payload, nil
}

func packShare(addr, token string) ([]byte, error) {
	kind, addrBody := packAddr(addr)
	tokenBody := []byte(token)
	if len(addrBody) > 0xffff || len(tokenBody) > 0xffff {
		return nil, ErrBadCode
	}
	out := make([]byte, 0, 1+2+len(addrBody)+2+len(tokenBody))
	out = append(out, kind)
	out = appendU16(out, len(addrBody))
	out = append(out, addrBody...)
	out = appendU16(out, len(tokenBody))
	out = append(out, tokenBody...)
	return out, nil
}

// packAddr uses kind 1 when addr is exactly "tc" plus canonical unpadded base64url.
func packAddr(addr string) (byte, []byte) {
	rest, ok := strings.CutPrefix(addr, "tc")
	if !ok || rest == "" {
		return 0, []byte(addr)
	}
	raw, err := base64.RawURLEncoding.DecodeString(rest)
	if err != nil || "tc"+base64.RawURLEncoding.EncodeToString(raw) != addr {
		return 0, []byte(addr)
	}
	return 1, raw
}

func unpackAddr(kind byte, body []byte) (string, bool) {
	switch kind {
	case 0:
		if !utf8.Valid(body) {
			return "", false
		}
		return string(body), true
	case 1:
		return "tc" + base64.RawURLEncoding.EncodeToString(body), true
	default:
		return "", false
	}
}

func appendU16(buf []byte, n int) []byte {
	return append(buf, byte(n>>8), byte(n))
}

func takeField(buf []byte) ([]byte, []byte, bool) {
	if len(buf) < 2 {
		return nil, nil, false
	}
	n := int(buf[0])<<8 | int(buf[1])
	buf = buf[2:]
	if n > len(buf) {
		return nil, nil, false
	}
	return buf[:n], buf[n:], true
}

func (p JoinPayload) validate() error {
	if p.V != 1 || p.Kind != "miao" || !strings.HasPrefix(p.Addr, "tc") || strings.TrimSpace(p.Token) == "" {
		return ErrBadCode
	}
	return nil
}
