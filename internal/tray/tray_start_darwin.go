//go:build darwin

package tray

import (
	"github.com/energye/systray"
)

func (c *Controller) Start(icon []byte) {
	if skipTray(c) {
		return
	}
	// RunWithExternalLoop's ready callback is a library goroutine, not the
	// AppKit main thread. Menu calls hop there via invokeMenu.
	// nativeStart creates the NSStatusItem on whatever thread calls it.
	// Wails OnStartup is already a background goroutine, so Darwin must
	// dispatch start onto the main queue. Do not use "go start()" on Darwin:
	// that is the macOS launch crash (NSWindow off the main thread).
	start, _ := systray.RunWithExternalLoop(func() {
		invokeMenu(func() {
			c.install(icon)
		})
	}, func() {})
	startLoop(start)
}
