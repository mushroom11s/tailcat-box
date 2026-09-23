//go:build windows

package tray

func startLoop(start func()) {
	// energye nativeStart on Windows spawns its own message loop.
	go start()
}

func invokeMenu(fn func()) {
	fn()
}
