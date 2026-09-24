package main

import (
	"embed"
	goruntime "runtime"
	"strings"

	"github.com/mushroom11s/tailcat-box/internal/tray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options.
	// Height 860 fits one in-progress Mew Share card (chrome, file name,
	// code, expiry, packing cat, and actions) under the share controls.
	// 760 clips that card. Windows includes the title bar in this height;
	// macOS and Linux use it as the content height.
	err := wails.Run(&options.App{
		Title:             windowTitle,
		Width:             1100,
		Height:            860,
		HideWindowOnClose: true,
		// macOS draws this in the system menu bar. Windows and Linux would
		// draw it as a second bar under the native title, so it stays unset.
		Menu: app.startupApplicationMenu(),
		// Mac is ignored on Windows and Linux. Leave Fullscreen unset so the
		// window opens windowed; the green button and View menu enter fullscreen.
		Mac: macWindowChrome(),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

// usesSystemMenuBar reports whether the OS shows the application menu outside
// the window. Windows and Linux paint it as an in-window menu strip.
func usesSystemMenuBar() bool {
	return goruntime.GOOS == "darwin"
}

func (a *App) startupApplicationMenu() *menu.Menu {
	if a == nil || !usesSystemMenuBar() {
		return nil
	}
	return a.applicationMenu(productTitle("en"))
}

func (a *App) syncApplicationMenu(title string) {
	if a == nil || a.ctx == nil || !usesSystemMenuBar() {
		return
	}
	runtime.MenuSetApplicationMenu(a.ctx, a.applicationMenu(title))
}

func (a *App) applicationMenu(title string) *menu.Menu {
	labels := tray.LabelsForLocale("")
	if a != nil {
		labels = tray.LabelsForLocale(a.uiLocale)
	}
	m := menu.NewMenu()
	appMenu := m.AddSubmenu(title)
	appMenu.AddText(labels.Open, nil, func(_ *menu.CallbackData) {
		a.showWindow()
	})
	appMenu.AddText(labels.Hide, nil, func(_ *menu.CallbackData) {
		a.hideWindow()
	})
	appMenu.AddSeparator()
	appMenu.AddText(labels.Chat, nil, func(_ *menu.CallbackData) {
		a.navigate(tray.PageChat)
	})
	appMenu.AddText(labels.Tunnel, nil, func(_ *menu.CallbackData) {
		a.navigate(tray.PageTunnel)
	})
	appMenu.AddText(labels.Settings, nil, func(_ *menu.CallbackData) {
		a.navigate(tray.PageSettings)
	})
	appMenu.AddSeparator()
	appMenu.AddText(labels.Quit, nil, func(_ *menu.CallbackData) {
		a.quitApp()
	})

	// A custom menu replaces the macOS defaults. Without the standard Edit
	// role, the webview never receives Cmd+C, Cmd+V, Cmd+X, Cmd+A, or Cmd+Z.
	// https://wails.io/docs/reference/menus
	m.Append(menu.EditMenu())

	viewTitle, fullscreenLabel := viewMenuLabels(a.menuLocale(), a.windowFullscreen)
	viewMenu := m.AddSubmenu(viewTitle)
	// Control-Command-F is the macOS shortcut for Enter/Exit Full Screen.
	viewMenu.AddText(fullscreenLabel, keys.Combo("f", keys.ControlKey, keys.CmdOrCtrlKey), func(_ *menu.CallbackData) {
		a.toggleFullscreen()
	})
	return m
}

// macWindowChrome keeps the standard macOS title bar and enables the green
// traffic-light button. Wails v2.16 leaves that button disabled when Mac is
// nil (zoomable stays 0). TitleBarDefault does not hide the title or draw
// content under the bar, so the page stays below the native title.
func macWindowChrome() *mac.Options {
	return &mac.Options{
		TitleBar:    mac.TitleBarDefault(),
		DisableZoom: false,
	}
}

func (a *App) menuLocale() string {
	if a == nil {
		return ""
	}
	return a.uiLocale
}

func viewMenuLabels(locale string, fullscreen bool) (title, item string) {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "zh-cn", "zh":
		title = "视图"
		item = "进入全屏"
		if fullscreen {
			item = "退出全屏"
		}
	default:
		title = "View"
		item = "Enter Full Screen"
		if fullscreen {
			item = "Exit Full Screen"
		}
	}
	return title, item
}

// toggleFullscreen follows the View menu label. WindowFullscreen is a no-op
// when the window is already fullscreen, so a green-button change that the
// menu has not seen yet updates the label without leaving fullscreen.
func (a *App) toggleFullscreen() {
	if a == nil || a.ctx == nil {
		return
	}
	if a.windowFullscreen {
		runtime.WindowUnfullscreen(a.ctx)
		a.windowFullscreen = false
	} else {
		runtime.WindowFullscreen(a.ctx)
		a.windowFullscreen = true
	}
	a.syncApplicationMenu(productTitle(a.uiLocale))
}
