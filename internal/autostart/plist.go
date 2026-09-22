package autostart

import (
	"fmt"
	"strings"
)

const (
	appName = "Tailcat Box"
	label   = "com.mushroom11s.tailcat-desktop-client"
)

// LaunchAgentPlist returns a macOS LaunchAgent plist that starts exe at login.
func LaunchAgentPlist(labelName, exe string) []byte {
	esc := func(s string) string {
		s = strings.ReplaceAll(s, "&", "&amp;")
		s = strings.ReplaceAll(s, "<", "&lt;")
		s = strings.ReplaceAll(s, ">", "&gt;")
		return s
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
`, esc(labelName), esc(exe))
	return []byte(body)
}
