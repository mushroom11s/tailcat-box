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
	start, _ := systray.RunWithExternalLoop(func() {
		if len(icon) > 0 {
			systray.SetIcon(icon)
		}
		systray.SetTitle("Tailcat")
		systray.SetTooltip("Tailcat desktop client")
		openItem := systray.AddMenuItem(LabelOpen, "Show the Tailcat window")
		openItem.Click(c.Open)
		countItem := systray.AddMenuItem(SessionCountLabel(0), "")
		countItem.Disable()
		c.SetLabelUpdater(func(s string) {
			countItem.SetTitle(s)
		})
		systray.AddSeparator()
		quitItem := systray.AddMenuItem(LabelQuit, "Quit Tailcat")
		quitItem.Click(func() {
			c.Quit()
			systray.Quit()
		})
		c.Refresh()
	}, func() {})
	go start()
}
