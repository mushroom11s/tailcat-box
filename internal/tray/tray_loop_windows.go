//go:build windows

package tray

import (
	"runtime"

	"github.com/energye/systray"
)

// Start installs the notification-area icon and pumps its messages.
//
// Win32 delivers tray clicks to the OS thread that created the tray HWND.
// energye/systray RunWithExternalLoop creates that window on the caller, then
// nativeStart pumps GetMessage on a different goroutine, so clicks never
// arrive. systray.Run does both on the caller. LockOSThread keeps this
// goroutine on that same thread for the life of the loop; it must not migrate
// between CreateWindow and GetMessage.
func (c *Controller) Start(icon []byte) {
	if skipTray(c) {
		return
	}
	go func() {
		runtime.LockOSThread()
		systray.Run(func() {
			c.install(icon)
		}, func() {})
	}()
}
