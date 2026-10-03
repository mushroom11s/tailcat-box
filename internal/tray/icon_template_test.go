package tray

import (
	"bytes"
	"image/png"
	"os"
	"strings"
	"testing"
)

func TestMenuTemplateIsGrayAlphaNotColorCat(t *testing.T) {
	data, err := os.ReadFile("icons/menu_template.png")
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	bounds := img.Bounds()
	if bounds.Dx() != 22 || bounds.Dy() != 22 {
		t.Fatalf("size=%v, want 22x22 menu-bar template", bounds)
	}
	_, _, _, corner := img.At(0, 0).RGBA()
	if corner != 0 {
		t.Fatalf("corner alpha=%d, background should be clear", corner)
	}
	var opaque, partial int
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if r != 0 || g != 0 || b != 0 {
				t.Fatalf("color pixel at %d,%d (%d,%d,%d); template must be black + alpha", x, y, r, g, b)
			}
			if a == 0xffff {
				opaque++
			} else if a > 0 {
				partial++
			}
		}
	}
	if opaque < 40 {
		t.Fatalf("opaque pixels=%d, cat body missing", opaque)
	}
	if partial < 20 {
		t.Fatalf("partial alpha=%d, ears/tray/shirt detail missing", partial)
	}
	color, err := os.ReadFile("icons/icon32.png")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(data, color) {
		t.Fatal("template icon is the full-color tray PNG")
	}
	darwin := nonCommentCode(t, "tray_install_darwin.go")
	if !strings.Contains(darwin, "SetTemplateIcon(") {
		t.Fatal("darwin status item must be a template image")
	}
	if strings.Contains(darwin, "SetIcon(") {
		t.Fatal("darwin must not SetIcon with the color PNG")
	}
}
