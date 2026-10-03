//go:build !windows && !darwin

package tray

import _ "embed"

// DefaultIcon is the non-Mac tray image: the same pixel-art cat as
// build/appicon.png, at 32×32 with a transparent background.
// Darwin uses the template icon in icon_darwin.go instead.
//
//go:embed icons/icon32.png
var DefaultIcon []byte
