package tray

import "testing"

func TestBindLabelsAppliesStoredThenLaterLocale(t *testing.T) {
	c := New(nil, nil, nil)
	c.SetLocale("zh-CN")
	var got MenuLabels
	c.bindLabels(func(l MenuLabels) { got = l })
	if got.Open != "打开" || got.Settings != "设置" {
		t.Fatalf("initial=%+v", got)
	}
	c.SetLocale("en")
	if got.Hide != "Hide" || got.Quit != "Quit" || got.Chat != "Chat" {
		t.Fatalf("updated=%+v", got)
	}
}
