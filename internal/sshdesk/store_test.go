package sshdesk

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingDefaultsOff(t *testing.T) {
	_, st, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if st.Enabled || st.AllowAny || st.Address != "" || len(st.Peers) != 0 || st.IdentityJSON != "" {
		t.Fatalf("%+v", st)
	}
}

func TestSaveRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	in := State{
		Enabled:      true,
		AllowAny:     false,
		Address:      "tc:desk",
		IdentityJSON: `{"fake":"abc"}`,
		Peers: []Peer{
			{Name: "laptop", Address: "tc:laptop"},
			{Name: "dup", Address: "tc:laptop"},
			{Address: "  "},
			{Name: " studio ", Address: " tc:studio "},
		},
	}
	if err := s.Save(in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "ssh.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%v", info.Mode().Perm())
	}
	got, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.AllowAny || got.Address != "tc:desk" || got.IdentityJSON != `{"fake":"abc"}` {
		t.Fatalf("%+v", got)
	}
	if len(got.Peers) != 2 || got.Peers[0].Address != "tc:laptop" || got.Peers[0].Name != "laptop" {
		t.Fatalf("peers=%+v", got.Peers)
	}
	if got.Peers[1].Name != "studio" || got.Peers[1].Address != "tc:studio" {
		t.Fatalf("peers=%+v", got.Peers)
	}
}

func TestAllowKeysDedupesSavedAndRooms(t *testing.T) {
	got := AllowKeys([]string{" nodekey:b ", "", "nodekey:a"}, []string{"nodekey:b", "nodekey:c"})
	want := []string{"nodekey:a", "nodekey:b", "nodekey:c"}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	rooms := RoomOnly([]Peer{{Address: "tc:saved"}}, []string{"tc:saved", "tc:room", "tc:room"})
	if len(rooms) != 1 || rooms[0] != "tc:room" {
		t.Fatalf("%v", rooms)
	}
}
