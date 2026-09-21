//go:build !windows

package tray

import _ "embed"

// DefaultIcon is the Tailcat Box menu-bar / tray image: the same pixel-art
// cat as build/appicon.png, at 32×32 with a transparent background.
//
//go:embed icons/icon32.png
var DefaultIcon []byte
