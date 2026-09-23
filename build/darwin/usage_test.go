package plist_test

import (
	"os"
	"regexp"
	"testing"
)

// Wails copies these templates into tailcat-box.app/Contents/Info.plist.
// macOS will not show microphone, camera, or screen-recording prompts without
// the usage strings, so both the release plist and the wails dev plist must
// carry the same non-empty values.
func TestDarwinPrivacyUsageDescriptions(t *testing.T) {
	want := map[string]string{
		"NSMicrophoneUsageDescription":    "Tailcat Box uses the microphone for voice notes and live calls.",
		"NSCameraUsageDescription":        "Tailcat Box uses the camera for live video calls.",
		"NSScreenCaptureUsageDescription": "Tailcat Box records the screen when you share it in a call.",
	}
	re := regexp.MustCompile(`<key>([^<]+)</key>\s*<string>([^<]*)</string>`)
	for _, name := range []string{"Info.plist", "Info.dev.plist"} {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		found := map[string]string{}
		for _, match := range re.FindAllStringSubmatch(string(body), -1) {
			found[match[1]] = match[2]
		}
		for key, value := range want {
			got, ok := found[key]
			if !ok {
				t.Errorf("%s missing %s", name, key)
				continue
			}
			if got != value {
				t.Errorf("%s %s = %q, want %q", name, key, got, value)
			}
		}
	}
}
