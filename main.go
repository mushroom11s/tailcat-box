package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

func main() {
	// Create an instance of the app structure
	app := NewApp()
	app.trayIcon = trayIcon

	// Create application with options
	err := wails.Run(&options.App{
		Title:             "Tailcat Box",
		Width:             1100,
		Height:            760,
		HideWindowOnClose: true,
		Menu:              app.applicationMenu(),
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

func (a *App) applicationMenu() *menu.Menu {
	m := menu.NewMenu()
	appMenu := m.AddSubmenu("Tailcat Box")
	appMenu.AddText("Open", nil, func(_ *menu.CallbackData) {
		a.showWindow()
	})
	appMenu.AddText("Quit", nil, func(_ *menu.CallbackData) {
		a.quitApp()
	})
	return m
}
