//go:build darwin

package tray

/*
#cgo darwin LDFLAGS: -framework Foundation
#include <dispatch/dispatch.h>
#include <pthread.h>

extern void trayInvokeMain(void);

static void tray_invoke_thunk(void *ctx) {
	(void)ctx;
	trayInvokeMain();
}

// trayDispatchAsync schedules trayInvokeMain on the AppKit main queue.
// dispatch_async_f is pure C, so this does not need an Objective-C block.
static void trayDispatchAsync(void) {
	dispatch_async_f(dispatch_get_main_queue(), NULL, tray_invoke_thunk);
}

static int trayOnMainThread(void) {
	return pthread_main_np();
}
*/
import "C"

// appKitQueue is the only path that may call energye/systray nativeStart
// or build the menu on Darwin. Both create AppKit objects.
var appKitQueue = &mainQueue{
	isMain: func() bool { return C.trayOnMainThread() != 0 },
	async:  func() { C.trayDispatchAsync() },
}

func startLoop(start func()) {
	appKitQueue.asyncCall(start)
}

func invokeMenu(fn func()) {
	appKitQueue.syncCall(fn)
}
