package miao

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestEncodeJoinRoundTrip(t *testing.T) {
	cases := []struct {
		addr  string
		token string
	}{
		{addr: "tc:room", token: "abc"},
		{addr: "tc:fake-miao-abcdef01", token: "0123456789abcdef0123456789abcdef"},
		{addr: canonicalAddr(t, bytes.Repeat([]byte{0x11}, 80)), token: "0123456789abcdef0123456789abcdef"},
	}
	for _, tc := range cases {
		compact, err := EncodeJoin(tc.addr, tc.token)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(compact, "mw1.") || strings.Contains(compact, "=") || strings.Contains(compact, "{") {
			t.Fatalf("code=%q", compact)
		}
		got, err := ParseJoin("  " + compact + "\n")
		if err != nil {
			t.Fatal(err)
		}
		if got.V != 1 || got.Kind != "miao" || got.Addr != tc.addr || got.Token != tc.token {
			t.Fatalf("got=%+v", got)
		}
		legacy, err := json.Marshal(JoinPayload{V: 1, Kind: "miao", Addr: tc.addr, Token: tc.token})
		if err != nil {
			t.Fatal(err)
		}
		if len(tc.addr) > 40 && len(compact) >= len(legacy) {
			t.Fatalf("compact %d not shorter than json %d (%q)", len(compact), len(legacy), compact)
		}
	}

	const want = "mw1.AAAHdGM6cm9vbQADYWJj"
	got, err := EncodeJoin("tc:room", "abc")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("golden=%q got=%q", want, got)
	}
	compressed, err := EncodeJoin("tcEREREQ", "abcd")
	if err != nil {
		t.Fatal(err)
	}
	if compressed != "mw1.AQAEEREREQAEYWJjZA" {
		t.Fatalf("compressed=%q", compressed)
	}
}

func TestParseJoinLegacyJSON(t *testing.T) {
	raw := `{"v":1,"kind":"miao","addr":"tc:room","token":"abc"}`
	got, err := ParseJoin(" \n" + raw + " ")
	if err != nil {
		t.Fatal(err)
	}
	if got.Addr != "tc:room" || got.Token != "abc" || got.V != 1 || got.Kind != "miao" {
		t.Fatalf("got=%+v", got)
	}
}

func TestParseJoinRejectsGarbage(t *testing.T) {
	bad := []string{
		"",
		"tc:room",
		"mw1.",
		"mw1.!!!!",
		"mw1.YQ",
		"mw1." + base64.RawURLEncoding.EncodeToString([]byte{9, 0, 1, 'x', 0, 1, 'y'}),
		`{"v":2,"kind":"miao","addr":"tc:room","token":"abc"}`,
		`{"v":1,"kind":"other","addr":"tc:room","token":"abc"}`,
		`{"v":1,"kind":"miao","addr":"room","token":"abc"}`,
		`{"v":1,"kind":"miao","addr":"tc:room"}`,
		`{"v":1,"kind":"miao","addr":"tc:room","token":" "}`,
	}
	for _, raw := range bad {
		if _, err := ParseJoin(raw); !errors.Is(err, ErrBadCode) {
			t.Fatalf("raw=%q err=%v", raw, err)
		}
	}
}

func canonicalAddr(t *testing.T, raw []byte) string {
	t.Helper()
	return "tc" + base64.RawURLEncoding.EncodeToString(raw)
}
