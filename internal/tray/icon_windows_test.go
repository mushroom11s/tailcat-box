//go:build windows

package tray_test

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/mushroom11s/tailcat-desktop-client/internal/tray"
)

func TestDefaultIconIsICO(t *testing.T) {
	data := tray.DefaultIcon
	if len(data) < 6 {
		t.Fatal("tray icon is empty")
	}
	if !bytes.Equal(data[:4], []byte{0, 0, 1, 0}) {
		t.Fatalf("expected ICO header, got %x", data[:4])
	}
	count := binary.LittleEndian.Uint16(data[4:6])
	if count < 3 {
		t.Fatalf("icon count=%d, want 16/22/32 plus larger sizes", count)
	}
}
