//go:build windows

package tray

import _ "embed"

// DefaultIcon is the Tailcat Box tray image: the same pixel-art cat as
// build/appicon.png, packed as an ICO (16, 22, and 32px, plus larger sizes)
// so the Windows shell can load it. PNG bytes are not a valid tray icon here.
//
//go:embed icons/icon.ico
var DefaultIcon []byte
