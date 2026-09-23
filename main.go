package main

import (
	"embed"
	goruntime "runtime"

	"github.com/mushroom11s/tailcat-box/internal/tray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:             windowTitle,
		Width:             1100,
		Height:            760,
		HideWindowOnClose: true,
		// macOS draws this in the system menu bar. Windows and Linux would
		// draw it as a second bar under the native title, so it stays unset.
		Menu: app.startupApplicationMenu(),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		OnStartup: app.startup,
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
	return m
}
