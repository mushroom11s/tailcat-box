package tray

import (
	"fmt"
	"sync"
)

const (
	LabelOpen = "Open"
	LabelQuit = "Quit"
)

func SessionCountLabel(n int) string {
	switch {
	case n <= 0:
		return "No active sessions"
	case n == 1:
		return "1 active session"
	default:
		return fmt.Sprintf("%d active sessions", n)
	}
}

type Controller struct {
	open         func()
	quit         func()
	count        func() int
	setCount     func(string)
	mu           sync.Mutex
	title        string
	tooltip      string
	applyProduct func(title, tooltip string)
}

func New(open, quit func(), count func() int) *Controller {
	return &Controller{open: open, quit: quit, count: count}
}

// SetProductName stores the tray title and tooltip. Native trays apply it
// once the icon loop is running; other platforms keep the strings only.
func (c *Controller) SetProductName(title, tooltip string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.title = title
	c.tooltip = tooltip
	fn := c.applyProduct
	c.mu.Unlock()
	if fn != nil {
		fn(title, tooltip)
	}
}

// bindProduct registers the native updater and applies the current name.
func (c *Controller) bindProduct(fn func(title, tooltip string)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.applyProduct = fn
	title, tooltip := c.title, c.tooltip
	c.mu.Unlock()
	if title == "" {
		title = "Tailcat Box"
	}
	if tooltip == "" {
		tooltip = title
	}
	fn(title, tooltip)
	c.mu.Lock()
	latestTitle, latestTip := c.title, c.tooltip
	c.mu.Unlock()
	if latestTitle != "" && (latestTitle != title || latestTip != tooltip) {
		if latestTip == "" {
			latestTip = latestTitle
		}
		fn(latestTitle, latestTip)
	}
}

func (c *Controller) SetLabelUpdater(fn func(string)) {
	if c == nil {
		return
	}
	c.setCount = fn
}

func (c *Controller) Open() {
	if c != nil && c.open != nil {
		c.open()
	}
}

func (c *Controller) Quit() {
	if c != nil && c.quit != nil {
		c.quit()
	}
}

func (c *Controller) Refresh() {
	if c == nil || c.setCount == nil {
		return
	}
	n := 0
	if c.count != nil {
		n = c.count()
	}
	c.setCount(SessionCountLabel(n))
}
