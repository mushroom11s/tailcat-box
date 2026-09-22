package tray_test

import (
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/tray"
)

func TestSessionCountLabel(t *testing.T) {
	if got := tray.SessionCountLabel(0); got != "No active sessions" {
		t.Fatalf("got=%q", got)
	}
	if got := tray.SessionCountLabel(1); got != "1 active session" {
		t.Fatalf("got=%q", got)
	}
	if got := tray.SessionCountLabel(3); got != "3 active sessions" {
		t.Fatalf("got=%q", got)
	}
}

func TestSetProductNameBeforeTrayLoop(t *testing.T) {
	c := tray.New(nil, nil, nil)
	c.SetProductName("猫砂盆", "猫砂盆")
	c.SetProductName("Tailcat Box", "Tailcat Box")
}

func TestControllerOpenQuitRefresh(t *testing.T) {
	opened := 0
	quit := 0
	count := 2
	label := ""
	c := tray.New(func() { opened++ }, func() { quit++ }, func() int { return count })
	c.SetLabelUpdater(func(s string) { label = s })
	c.Open()
	c.Quit()
	c.Refresh()
	if opened != 1 || quit != 1 {
		t.Fatalf("opened=%d quit=%d", opened, quit)
	}
	if label != "2 active sessions" {
		t.Fatalf("label=%q", label)
	}
}
