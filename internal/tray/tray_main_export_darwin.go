//go:build darwin

package tray

import "C"

// trayInvokeMain runs queued tray work on the calling OS thread.
// Darwin schedules it with dispatch_async_f on the main queue.
// The export is in its own file so its cgo preamble stays empty.

//export trayInvokeMain
func trayInvokeMain() {
	appKitQueue.drain()
}
