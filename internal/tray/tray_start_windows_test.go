//go:build windows

package tray

import (
	"testing"
	"time"
)

func TestWindowsStartNoTrayReturns(t *testing.T) {
	t.Setenv("TAILCAT_NO_TRAY", "1")
	c := New(nil, nil, nil)
	done := make(chan struct{})
	go func() {
		c.Start(nil)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Start blocked even though TAILCAT_NO_TRAY is set")
	}

	var nilC *Controller
	nilC.Start(nil)
}
