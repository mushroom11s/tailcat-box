package tray

import (
	"fmt"
	"strings"
	"sync"
)

const (
	LabelOpen     = "Open"
	LabelHide     = "Hide"
	LabelChat     = "Chat"
	LabelTunnel   = "Tunnel"
	LabelSettings = "Settings"
	LabelQuit     = "Quit"

	// Page ids match the frontend shell (Chat | Tunnel | Settings).
	PageChat     = "chat"
	PageTunnel   = "tunnel"
	PageSettings = "settings"

	// NavigateEvent is emitted with a page id when a tray or app-menu
	// item should show that page. The frontend listens for this name.
	NavigateEvent = "tailcat:navigate"
)

// MenuLabels are the localized tray and macOS app-menu captions.
type MenuLabels struct {
	Open     string
	Hide     string
	Chat     string
	Tunnel   string
	Settings string
	Quit     string
}

// LabelsForLocale returns tray captions for the UI locale.
// zh and zh-CN use 简体中文; every other value uses English.
func LabelsForLocale(locale string) MenuLabels {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "zh-cn", "zh":
		return MenuLabels{
			Open:     "打开",
			Hide:     "隐藏",
			Chat:     "聊天",
			Tunnel:   "穿透",
			Settings: "设置",
			Quit:     "退出",
		}
	default:
		return MenuLabels{
			Open:     LabelOpen,
			Hide:     LabelHide,
			Chat:     LabelChat,
			Tunnel:   LabelTunnel,
			Settings: LabelSettings,
			Quit:     LabelQuit,
		}
	}
}

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
	hide         func()
	quit         func()
	navigate     func(page string)
	count        func() int
	setCount     func(string)
	mu           sync.Mutex
	title        string
	tooltip      string
	labels       MenuLabels
	applyProduct func(title, tooltip string)
	applyLabels  func(MenuLabels)
}

func New(open, quit func(), count func() int) *Controller {
	return &Controller{
		open:   open,
		quit:   quit,
		count:  count,
		labels: LabelsForLocale("en"),
	}
}

// SetHide registers the action for the Hide menu item.
func (c *Controller) SetHide(fn func()) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.hide = fn
	c.mu.Unlock()
}

// SetNavigate registers the action for Chat, Tunnel, and Settings.
// The page argument is PageChat, PageTunnel, or PageSettings.
func (c *Controller) SetNavigate(fn func(page string)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.navigate = fn
	c.mu.Unlock()
}

// SetLocale stores captions for locale and applies them when the menu exists.
func (c *Controller) SetLocale(locale string) {
	if c == nil {
		return
	}
	labels := LabelsForLocale(locale)
	c.mu.Lock()
	c.labels = labels
	fn := c.applyLabels
	c.mu.Unlock()
	if fn != nil {
		fn(labels)
	}
}

// Labels returns the captions currently stored on the controller.
func (c *Controller) Labels() MenuLabels {
	if c == nil {
		return LabelsForLocale("en")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.labels
}

// bindLabels registers the native updater and applies the current captions.
func (c *Controller) bindLabels(fn func(MenuLabels)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.applyLabels = fn
	labels := c.labels
	c.mu.Unlock()
	if labels.Open == "" {
		labels = LabelsForLocale("en")
	}
	fn(labels)
	c.mu.Lock()
	latest := c.labels
	c.mu.Unlock()
	if latest != labels {
		fn(latest)
	}
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
	if c == nil {
		return
	}
	c.mu.Lock()
	fn := c.open
	c.mu.Unlock()
	if fn != nil {
		fn()
	}
}

func (c *Controller) Hide() {
	if c == nil {
		return
	}
	c.mu.Lock()
	fn := c.hide
	c.mu.Unlock()
	if fn != nil {
		fn()
	}
}

func (c *Controller) Quit() {
	if c == nil {
		return
	}
	c.mu.Lock()
	fn := c.quit
	c.mu.Unlock()
	if fn != nil {
		fn()
	}
}

func (c *Controller) Navigate(page string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	fn := c.navigate
	c.mu.Unlock()
	if fn != nil {
		fn(page)
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
