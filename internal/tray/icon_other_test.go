//go:build !windows

package tray_test

import (
	"bytes"
	"image/png"
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/tray"
)

func TestDefaultIconIsPixelArtWithTransparentBackground(t *testing.T) {
	if len(tray.DefaultIcon) < 32 {
		t.Fatal("tray icon is empty")
	}
	img, err := png.Decode(bytes.NewReader(tray.DefaultIcon))
	if err != nil {
		t.Fatal(err)
	}
	bounds := img.Bounds()
	if bounds.Dx() != 32 || bounds.Dy() != 32 {
		t.Fatalf("size=%v", bounds)
	}
	_, _, _, alpha := img.At(0, 0).RGBA()
	if alpha != 0 {
		t.Fatalf("corner alpha=%d, background should be transparent", alpha)
	}
	_, _, _, mid := img.At(bounds.Dx()/2, bounds.Dy()/2).RGBA()
	if mid == 0 {
		t.Fatal("center of the tray icon is transparent")
	}
}
