//go:build darwin

package tray

import _ "embed"

// DefaultIcon is the macOS menu-bar image. It is a template (black pixels,
// alpha only) so AppKit tints it for light and dark menu bars. It is not
// the full-color tray PNG.
//
//go:embed icons/menu_template.png
var DefaultIcon []byte
