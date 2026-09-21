package tray

import "fmt"

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
	open     func()
	quit     func()
	count    func() int
	setCount func(string)
}

func New(open, quit func(), count func() int) *Controller {
	return &Controller{open: open, quit: quit, count: count}
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
