package notify

// OpenEvent asks the frontend to focus a page after a notification click.
const OpenEvent = "tailcat:notify-open"

// OpenTarget is the view a notification click should reveal.
type OpenTarget struct {
	Page string `json:"page"`
	Room string `json:"room,omitempty"`
}

// TargetFromUserInfo reads the page attached to a Wails notification.
// Unknown payloads are ignored so a click can still focus the window.
func TargetFromUserInfo(info map[string]interface{}) (OpenTarget, bool) {
	if info == nil {
		return OpenTarget{}, false
	}
	page, _ := info["page"].(string)
	room, _ := info["room"].(string)
	switch page {
	case "chat", "miao":
		return OpenTarget{Page: page, Room: room}, true
	default:
		return OpenTarget{}, false
	}
}
