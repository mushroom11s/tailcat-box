//go:build darwin

package tray

import (
	"github.com/energye/systray"
)

// runAction schedules tray menu work after the current NSMenu action returns.
// energye delivers MenuItem.Click on the AppKit main thread via a cgo export
// inside menuHandler:. Calling Wails WindowShow / EventsEmit / Quit there
// re-enters AppKit/WebKit while the status-item menu is still tracking and
// aborts (Chat / Tunnel / Settings crash on click). A short-lived goroutine
// is enough: Wails Show/Hide already hop to the main queue with dispatch_async.
func runAction(fn func()) {
	if fn == nil {
		return
	}
	go fn()
}

func (c *Controller) install(icon []byte) {
	if len(icon) == 0 {
		icon = DefaultIcon
	}
	if len(icon) > 0 {
		// Template, not the color PNG. SetOnClick stays off: it crashes the menu.
		systray.SetTemplateIcon(icon, icon)
	}
	c.bindProduct(func(title, tooltip string) {
		// Icon-only menu bar: tooltip only, no SetTitle text beside the icon.
		systray.SetTooltip(tooltip)
	})

	// energye/systray leaves statusItem.menu nil on Darwin. SetOnClick/
	// SetOnRClick call enable_on_click, which intercepts mouse events and
	// shows the menu only via show_menu: attach -> performClick -> setMenu:nil
	// immediately. That tear-down races AppKit menu tracking and errors when
	// opening the menu or choosing an item. Permanently attach with
	// CreateMenu instead (standard macOS menu-bar UX: click shows the menu).
	// Do not SetOnClick/SetOnRClick: those re-enable the broken path.
	//
	// Menu *actions* must not use invokeMenu/syncCall: Click already runs on
	// the AppKit main thread, so syncCall would execute Wails work inline
	// during menu tracking. Use runAction instead.

	labels := c.Labels()
	openItem := systray.AddMenuItem(labels.Open, "")
	openItem.Click(func() {
		runAction(c.Open)
	})
	hideItem := systray.AddMenuItem(labels.Hide, "")
	hideItem.Click(func() {
		runAction(c.Hide)
	})
	systray.AddSeparator()
	chatItem := systray.AddMenuItem(labels.Chat, "")
	chatItem.Click(func() {
		runAction(func() { c.Navigate(PageChat) })
	})
	tunnelItem := systray.AddMenuItem(labels.Tunnel, "")
	tunnelItem.Click(func() {
		runAction(func() { c.Navigate(PageTunnel) })
	})
	settingsItem := systray.AddMenuItem(labels.Settings, "")
	settingsItem.Click(func() {
		runAction(func() { c.Navigate(PageSettings) })
	})
	systray.AddSeparator()
	countItem := systray.AddMenuItem(SessionCountLabel(0), "")
	countItem.Disable()
	c.SetLabelUpdater(func(s string) {
		invokeMenu(func() {
			countItem.SetTitle(s)
		})
	})
	systray.AddSeparator()
	quitItem := systray.AddMenuItem(labels.Quit, "")
	quitItem.Click(func() {
		// Only runtime.Quit via c.Quit. systray.Quit runs [NSApp terminate:],
		// which energye's own example marks as a macOS error with an external
		// loop and races Wails shutdown.
		runAction(c.Quit)
	})
	c.bindLabels(func(l MenuLabels) {
		invokeMenu(func() {
			openItem.SetTitle(l.Open)
			hideItem.SetTitle(l.Hide)
			chatItem.SetTitle(l.Chat)
			tunnelItem.SetTitle(l.Tunnel)
			settingsItem.SetTitle(l.Settings)
			quitItem.SetTitle(l.Quit)
		})
	})
	systray.CreateMenu()
	c.Refresh()
}
