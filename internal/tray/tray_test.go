package tray_test

import (
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/tray"
)

func TestSessionCountLabel(t *testing.T) {
	if got := tray.SessionCountLabel(0); got != "No active sessions" {
		t.Fatalf("got=%q", got)
	}
	if got := tray.SessionCountLabel(1); got != "1 active session" {
		t.Fatalf("got=%q", got)
	}
	if got := tray.SessionCountLabel(3); got != "3 active sessions" {
		t.Fatalf("got=%q", got)
	}
}

func TestSetProductNameBeforeTrayLoop(t *testing.T) {
	c := tray.New(nil, nil, nil)
	c.SetProductName("猫砂盆", "猫砂盆")
	c.SetProductName("Tailcat Box", "Tailcat Box")
}

func TestControllerOpenQuitRefresh(t *testing.T) {
	opened := 0
	quit := 0
	count := 2
	label := ""
	c := tray.New(func() { opened++ }, func() { quit++ }, func() int { return count })
	c.SetLabelUpdater(func(s string) { label = s })
	c.Open()
	c.Quit()
	c.Refresh()
	if opened != 1 || quit != 1 {
		t.Fatalf("opened=%d quit=%d", opened, quit)
	}
	if label != "2 active sessions" {
		t.Fatalf("label=%q", label)
	}
}

func TestLabelsForLocale(t *testing.T) {
	en := tray.LabelsForLocale("en")
	if en.Open != "Open" || en.Hide != "Hide" || en.Chat != "Chat" || en.Tunnel != "Tunnel" || en.Settings != "Settings" || en.Quit != "Quit" {
		t.Fatalf("en=%+v", en)
	}
	if tray.LabelsForLocale("").Open != "Open" || tray.LabelsForLocale("fr").Quit != "Quit" {
		t.Fatal("unknown locale should stay English")
	}
	zh := tray.LabelsForLocale("zh-CN")
	if zh.Open != "打开" || zh.Hide != "隐藏" || zh.Chat != "聊天" || zh.Tunnel != "穿透" || zh.Settings != "设置" || zh.Quit != "退出" {
		t.Fatalf("zh-CN=%+v", zh)
	}
	if tray.LabelsForLocale("zh") != zh || tray.LabelsForLocale(" ZH-cn ") != zh {
		t.Fatal("zh aliases should match zh-CN")
	}
	if tray.NavigateEvent != "tailcat:navigate" {
		t.Fatalf("event=%q", tray.NavigateEvent)
	}
	if tray.PageChat != "chat" || tray.PageTunnel != "tunnel" || tray.PageSettings != "settings" {
		t.Fatal("page ids drifted from the frontend shell")
	}
}

func TestControllerHideNavigateAndLocale(t *testing.T) {
	hidden := 0
	page := ""
	c := tray.New(nil, nil, nil)
	c.SetHide(func() { hidden++ })
	c.SetNavigate(func(p string) { page = p })
	c.Hide()
	c.Navigate(tray.PageChat)
	c.Navigate(tray.PageSettings)
	if hidden != 1 || page != tray.PageSettings {
		t.Fatalf("hidden=%d page=%q", hidden, page)
	}
	c.SetLocale("zh-CN")
	if got := c.Labels(); got.Hide != "隐藏" || got.Tunnel != "穿透" {
		t.Fatalf("labels=%+v", got)
	}
	c.SetLocale("en")
	if got := c.Labels(); got.Open != "Open" || got.Quit != "Quit" {
		t.Fatalf("labels=%+v", got)
	}

	var nilCtrl *tray.Controller
	nilCtrl.SetHide(func() {})
	nilCtrl.SetNavigate(func(string) {})
	nilCtrl.SetLocale("zh-CN")
	nilCtrl.Hide()
	nilCtrl.Navigate(tray.PageChat)
	nilCtrl.Open()
	nilCtrl.Quit()
	if got := nilCtrl.Labels(); got.Open != "Open" {
		t.Fatalf("nil labels=%+v", got)
	}
}
