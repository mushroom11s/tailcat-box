//go:build windows

package sshterm

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func prepareConsole() error {
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	alloc := kernel.NewProc("AllocConsole")
	_, _, _ = alloc.Call()
	if title, err := windows.UTF16PtrFromString("Tailcat SSH"); err == nil {
		setTitle := kernel.NewProc("SetConsoleTitleW")
		_, _, _ = setTitle.Call(uintptr(unsafe.Pointer(title)))
	}
	in, err := os.OpenFile("CONIN$", os.O_RDWR, 0)
	if err != nil {
		return err
	}
	out, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		_ = in.Close()
		return err
	}
	os.Stdin = in
	os.Stdout = out
	os.Stderr = out
	return nil
}
