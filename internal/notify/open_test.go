package notify

import "testing"

func TestTargetFromUserInfo(t *testing.T) {
	if OpenEvent != "tailcat:notify-open" {
		t.Fatalf("event=%q", OpenEvent)
	}
	chat, ok := TargetFromUserInfo(map[string]interface{}{"page": "chat", "room": "abc"})
	if !ok || chat.Page != "chat" || chat.Room != "abc" {
		t.Fatalf("chat=%+v ok=%v", chat, ok)
	}
	miao, ok := TargetFromUserInfo(map[string]interface{}{"page": "miao"})
	if !ok || miao.Page != "miao" || miao.Room != "" {
		t.Fatalf("miao=%+v ok=%v", miao, ok)
	}
	if _, ok := TargetFromUserInfo(nil); ok {
		t.Fatal("nil info should not navigate")
	}
	if _, ok := TargetFromUserInfo(map[string]interface{}{"page": "settings"}); ok {
		t.Fatal("unknown page should not navigate")
	}
	if _, ok := TargetFromUserInfo(map[string]interface{}{"page": 1}); ok {
		t.Fatal("non-string page should not navigate")
	}
}
