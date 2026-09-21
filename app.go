package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/appinfo"
	"github.com/mushroom11s/tailcat-desktop-client/internal/autostart"
	"github.com/mushroom11s/tailcat-desktop-client/internal/service"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
	"github.com/mushroom11s/tailcat-desktop-client/internal/settings"
	"github.com/mushroom11s/tailcat-desktop-client/internal/store"
	"github.com/mushroom11s/tailcat-desktop-client/internal/sysinfo"
	"github.com/mushroom11s/tailcat-desktop-client/internal/tray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	tailcatEventName    = "tailcat:event"
	updateCheckInterval = 24 * time.Hour
	configDirName       = "tailcat-box"
	legacyConfigDirName = "tailcat-desktop-client"
)

// productTitle is the window, menu, and tray name for a UI locale.
func productTitle(locale string) string {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "zh-cn", "zh":
		return "猫砂盆"
	default:
		return "Tailcat Box"
	}
}

// App is the Wails-bound application. The UI talks only to these methods.
type App struct {
	ctx       context.Context
	svc       *service.Service
	keys      *store.Store
	tray      *tray.Controller
	trayIcon  []byte
	settings  *settings.Store
	startedAt time.Time
}

// ClientInfo is desktop-client metadata shown on Settings.
type ClientInfo struct {
	StartedAt       string
	AppVersion      string
	TailcatVersion  string
	LastUpdateCheck string
}

// SystemInfo is host metadata shown on Settings.
type SystemInfo struct {
	OSVersion              string
	LaunchAtLogin          bool
	LaunchAtLoginSupported bool
	NetworkOnline          bool
	NetworkSummary         string
}

func newAdapter() adapter.TailcatAdapter {
	if strings.EqualFold(os.Getenv("TAILCAT_ADAPTER"), "fake") {
		return adapter.NewFake()
	}
	return adapter.NewReal()
}

func newKeyStore() *store.Store {
	if dir := os.Getenv("TAILCAT_KEYS_DIR"); dir != "" {
		return store.New(dir)
	}
	root, conf, err := appConfigDir()
	if err != nil {
		return store.New("keys")
	}
	s := store.New(filepath.Join(root, "keys"))
	s.ExtraDir = filepath.Join(conf, "tailcat", "keys")
	return s
}

func newSettingsStore() *settings.Store {
	dir := os.Getenv("TAILCAT_SETTINGS_DIR")
	if dir == "" {
		root, _, err := appConfigDir()
		if err != nil {
			dir = "settings"
		} else {
			dir = root
		}
	}
	s, err := settings.Load(dir)
	if err != nil {
		return settings.New(dir)
	}
	return s
}

// chooseConfigDir picks the app config directory. New installs use nextName.
// An existing legacyName directory is kept when nextName does not exist yet.
func chooseConfigDir(base, nextName, legacyName string, exists func(string) bool) string {
	next := filepath.Join(base, nextName)
	if exists(next) {
		return next
	}
	legacy := filepath.Join(base, legacyName)
	if exists(legacy) {
		return legacy
	}
	return next
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// appConfigDir returns the config root and the OS user-config directory.
// The root is <user-config>/tailcat-box, or the legacy tailcat-desktop-client
// directory when that is the only one present.
func appConfigDir() (root string, userConfig string, err error) {
	userConfig, err = os.UserConfigDir()
	if err != nil {
		return "", "", err
	}
	root = chooseConfigDir(userConfig, configDirName, legacyConfigDirName, dirExists)
	return root, userConfig, nil
}

// SetUILocale applies the product name for locale to the window, app menu, and tray.
func (a *App) SetUILocale(locale string) {
	title := productTitle(locale)
	if a.tray != nil {
		a.tray.SetProductName(title, title)
	}
	if a.ctx == nil {
		return
	}
	runtime.WindowSetTitle(a.ctx, title)
	runtime.MenuSetApplicationMenu(a.ctx, a.applicationMenu(title))
}

// NewApp creates a new App application struct.
// The default adapter is the embedded Tailcat library; set TAILCAT_ADAPTER=fake
// for offline UI demos and tests.
func NewApp() *App {
	keys := newKeyStore()
	svc := service.New(newAdapter())
	if settings, err := keys.LoadSettings(); err == nil {
		svc.SetNetworkOpts(adapter.NetworkOpts{Region: settings.Region, DERPMapURL: settings.DERPMapURL})
	}
	return &App{
		svc:       svc,
		keys:      keys,
		settings:  newSettingsStore(),
		trayIcon:  tray.DefaultIcon,
		startedAt: time.Now(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.tray = tray.New(a.showWindow, a.quitApp, a.activeSessionCount)
	a.tray.Start(a.trayIcon)
	go a.forwardEvents()
	go a.maybeRecordDailyUpdateCheck()
}

func (a *App) maybeRecordDailyUpdateCheck() {
	if a.settings == nil {
		return
	}
	_, last := a.settings.Snapshot()
	if !last.IsZero() && time.Since(last) < updateCheckInterval {
		return
	}
	_, _ = a.RecordUpdateCheck()
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowShow(a.ctx)
}

func (a *App) quitApp() {
	if a.ctx == nil {
		return
	}
	runtime.Quit(a.ctx)
}

func (a *App) activeSessionCount() int {
	n := 0
	for _, sess := range a.svc.List() {
		if sess.Status != session.StatusStopped {
			n++
		}
	}
	return n
}

func (a *App) forwardEvents() {
	for ev := range a.svc.Events() {
		if a.tray != nil {
			a.tray.Refresh()
		}
		if a.ctx == nil {
			continue
		}
		runtime.EventsEmit(a.ctx, tailcatEventName, ev)
	}
}

// Greet returns a greeting for the given name (Wails template leftover until Task 6 UI).
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// StartPipeServe starts an ephemeral pipe serve session.
func (a *App) StartPipeServe() (session.Session, error) {
	return a.svc.StartPipeServe()
}

// DialPipe connects to addr and writes payload.
func (a *App) DialPipe(addr string, payload string) (session.Session, error) {
	return a.svc.DialPipe(addr, payload)
}

// StartPortServe starts a TCP port serve session.
func (a *App) StartPortServe(mappings []adapter.PortMapping) (session.Session, error) {
	return a.svc.StartPortServe(mappings)
}

// StartForward starts local TCP forwards to addr.
func (a *App) StartForward(addr string, mappings []adapter.PortMapping) (session.Session, error) {
	return a.svc.StartForward(addr, mappings)
}

// StartBrowse local-forwards port 80 and reports a local URL.
func (a *App) StartBrowse(addr string) (session.Session, error) {
	return a.svc.StartBrowse(addr)
}

// StartPing pings addr; untilDirect keeps going until a direct path is reported.
func (a *App) StartPing(addr string, untilDirect bool) (session.Session, error) {
	return a.svc.StartPing(addr, untilDirect)
}

// ParseAddr returns JSON describing a tailcat address.
func (a *App) ParseAddr(raw string) (string, error) {
	return a.svc.ParseAddr(raw)
}

// ResolveAddr returns a self-contained equivalent of raw.
func (a *App) ResolveAddr(raw string) (string, error) {
	return a.svc.ResolveAddr(raw)
}

// ListKeys lists saved keys.
func (a *App) ListKeys() ([]store.KeyInfo, error) {
	return a.keys.List()
}

// CreateKey generates and saves a named key.
func (a *App) CreateKey(name string, client bool, region string) (string, error) {
	return a.keys.Create(name, store.CreateOpts{Client: client, Region: region})
}

// DeleteKey removes a named key from the app key directory.
func (a *App) DeleteKey(name string) error {
	return a.keys.Delete(name)
}

// StopSession stops a running session.
func (a *App) StopSession(id string) error {
	return a.svc.Stop(id)
}

// ListSessions returns a snapshot of all sessions.
func (a *App) ListSessions() []session.Session {
	return a.svc.List()
}

// StartRecv starts a write-only receive inbox (CLI `recv`).
func (a *App) StartRecv(inboxDir string, acceptDirs bool) (session.Session, error) {
	return a.svc.StartRecv(inboxDir, acceptDirs)
}

// StartCopy sends local files to a peer (CLI `cp`).
func (a *App) StartCopy(addr string, localPaths []string, remotePath string) (session.Session, error) {
	return a.svc.StartCopy(addr, localPaths, remotePath)
}

// StartFilesServe serves a directory over SFTP (CLI `serve files`).
func (a *App) StartFilesServe(rootDir string, mode string) (session.Session, error) {
	return a.svc.StartFilesServe(rootDir, adapter.FilesServeOpts{Mode: adapter.FileServeMode(mode)})
}

// ListRemote lists a remote path on a files peer (CLI `ls`).
func (a *App) ListRemote(addr string, path string) ([]adapter.FileEntry, error) {
	return a.svc.ListRemote(addr, path)
}

// StartSSHServe starts keyed SSH or no-auth SSH. no-auth requires confirmDangerous.
func (a *App) StartSSHServe(noAuth bool, authorizedKeys string, confirmDangerous bool) (session.Session, error) {
	return a.svc.StartSSHServe(adapter.SSHServeOpts{NoAuth: noAuth, AuthorizedKeys: authorizedKeys}, confirmDangerous)
}

// StartSSHClient dials SSH on a Tailcat peer and runs command (default whoami).
func (a *App) StartSSHClient(addr string, command string, user string, identity string) (session.Session, error) {
	return a.svc.StartSSHClient(addr, adapter.SSHClientOpts{Command: command, User: user, Identity: identity})
}

// StartSOCKS starts a local SOCKS5 proxy toward addr.
func (a *App) StartSOCKS(addr string, listen string) (session.Session, error) {
	return a.svc.StartSOCKS(addr, listen)
}

// StartExitNode serves as a Tailcat exit node.
func (a *App) StartExitNode() (session.Session, error) {
	return a.svc.StartExitNode()
}

// StartExec runs command for each incoming connection (CLI `serve exec`).
func (a *App) StartExec(command string) (session.Session, error) {
	return a.svc.StartExec(strings.Fields(command))
}

// GetNetworkSettings returns persisted region / DERP map URL.
func (a *App) GetNetworkSettings() (store.Settings, error) {
	return a.keys.LoadSettings()
}

// SetNetworkSettings persists region / DERP map URL and applies them to the adapter.
func (a *App) SetNetworkSettings(region string, derpMapURL string) error {
	settings := store.Settings{Region: strings.TrimSpace(region), DERPMapURL: strings.TrimSpace(derpMapURL)}
	if err := a.keys.SaveSettings(settings); err != nil {
		return err
	}
	a.svc.SetNetworkOpts(adapter.NetworkOpts{Region: settings.Region, DERPMapURL: settings.DERPMapURL})
	return nil
}

// TailcatVersion reports the compiled github.com/tailscale/tailcat module version.
func (a *App) TailcatVersion() string {
	return adapter.TailcatVersion()
}

// SelectDirectory opens a native folder picker when a window is available.
func (a *App) SelectDirectory(title string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("directory picker requires a running window")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: title})
}

// SelectFiles opens a native multi-file picker when a window is available.
func (a *App) SelectFiles(title string) ([]string, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("file picker requires a running window")
	}
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: title})
}

// GetClientInfo returns uptime start time, app version, Tailcat module version, and last update check.
func (a *App) GetClientInfo() ClientInfo {
	info := ClientInfo{
		StartedAt:      a.startedAt.UTC().Format(time.RFC3339),
		AppVersion:     appinfo.ClientVersion(),
		TailcatVersion: appinfo.TailcatVersion(),
	}
	if a.settings != nil {
		_, last := a.settings.Snapshot()
		if !last.IsZero() {
			info.LastUpdateCheck = last.UTC().Format(time.RFC3339)
		}
	}
	return info
}

// RecordUpdateCheck stores the current time as the last Tailcat version inspection.
func (a *App) RecordUpdateCheck() (ClientInfo, error) {
	if a.settings == nil {
		return a.GetClientInfo(), fmt.Errorf("settings store is not available")
	}
	if err := a.settings.SetLastUpdateCheck(time.Now()); err != nil {
		return a.GetClientInfo(), err
	}
	return a.GetClientInfo(), nil
}

// GetSystemInfo returns OS version, launch-at-login state, and a local network summary.
func (a *App) GetSystemInfo() SystemInfo {
	return a.systemInfo()
}

// SetLaunchAtLogin updates the persisted preference and, on macOS/Windows, the OS login item.
func (a *App) SetLaunchAtLogin(enabled bool) (SystemInfo, error) {
	if autostart.Supported() {
		if err := autostart.SetEnabled(enabled); err != nil {
			return a.systemInfo(), err
		}
	}
	if a.settings != nil {
		if err := a.settings.SetLaunchAtLogin(enabled); err != nil {
			return a.systemInfo(), err
		}
	}
	return a.systemInfo(), nil
}

func (a *App) systemInfo() SystemInfo {
	net := sysinfo.Network()
	info := SystemInfo{
		OSVersion:              sysinfo.OSVersion(),
		LaunchAtLoginSupported: autostart.Supported(),
		NetworkOnline:          net.Online,
		NetworkSummary:         net.Summary,
	}
	if a.settings != nil {
		info.LaunchAtLogin, _ = a.settings.Snapshot()
	}
	if autostart.Supported() {
		if enabled, err := autostart.Enabled(); err == nil {
			info.LaunchAtLogin = enabled
		}
	}
	return info
}
