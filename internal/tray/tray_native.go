//go:build windows || darwin

package tray

import (
	"os"

	"github.com/energye/systray"
)

func (c *Controller) Start(icon []byte) {
	if c == nil || os.Getenv("TAILCAT_NO_TRAY") != "" {
		return
	}
	// RunWithExternalLoop's ready callback is a library goroutine, not the
	// AppKit main thread. Menu calls hop there on Darwin; Windows runs them
	// on that goroutine, which is what energye/systray expects.
	start, _ := systray.RunWithExternalLoop(func() {
		invokeMenu(func() {
			c.install(icon)
		})
	}, func() {})
	// nativeStart creates the NSStatusItem on whatever thread calls it.
	// Wails OnStartup is already a background goroutine, so Darwin must
	// dispatch start onto the main queue. Do not use "go start()" on Darwin:
	// that is the macOS launch crash (NSWindow off the main thread).
	startLoop(start)
}

func (c *Controller) install(icon []byte) {
	if len(icon) == 0 {
		icon = DefaultIcon
	}
	if len(icon) > 0 {
		systray.SetIcon(icon)
	}
	c.bindProduct(func(title, tooltip string) {
		systray.SetTitle(title)
		systray.SetTooltip(tooltip)
	})
	// Left-click shows the window. Right-click keeps the menu: Windows
	// shows it by default, and macOS shows it when OnRClick is unset.
	systray.SetOnClick(func(systray.IMenu) {
		c.Open()
	})

	labels := c.Labels()
	openItem := systray.AddMenuItem(labels.Open, "")
	openItem.Click(c.Open)
	hideItem := systray.AddMenuItem(labels.Hide, "")
	hideItem.Click(c.Hide)
	systray.AddSeparator()
	chatItem := systray.AddMenuItem(labels.Chat, "")
	chatItem.Click(func() { c.Navigate(PageChat) })
	tunnelItem := systray.AddMenuItem(labels.Tunnel, "")
	tunnelItem.Click(func() { c.Navigate(PageTunnel) })
	settingsItem := systray.AddMenuItem(labels.Settings, "")
	settingsItem.Click(func() { c.Navigate(PageSettings) })
	systray.AddSeparator()
	countItem := systray.AddMenuItem(SessionCountLabel(0), "")
	countItem.Disable()
	c.SetLabelUpdater(func(s string) {
		countItem.SetTitle(s)
	})
	systray.AddSeparator()
	quitItem := systray.AddMenuItem(labels.Quit, "")
	quitItem.Click(func() {
		c.Quit()
		systray.Quit()
	})
	c.bindLabels(func(l MenuLabels) {
		openItem.SetTitle(l.Open)
		hideItem.SetTitle(l.Hide)
		chatItem.SetTitle(l.Chat)
		tunnelItem.SetTitle(l.Tunnel)
		settingsItem.SetTitle(l.Settings)
		quitItem.SetTitle(l.Quit)
	})
	c.Refresh()
}
