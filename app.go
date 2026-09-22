package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"encoding/base64"
	"encoding/json"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/appinfo"
	"github.com/mushroom11s/tailcat-box/internal/autostart"
	"github.com/mushroom11s/tailcat-box/internal/chat"
	"github.com/mushroom11s/tailcat-box/internal/service"
	"github.com/mushroom11s/tailcat-box/internal/session"
	"github.com/mushroom11s/tailcat-box/internal/settings"
	"github.com/mushroom11s/tailcat-box/internal/store"
	"github.com/mushroom11s/tailcat-box/internal/sysinfo"
	"github.com/mushroom11s/tailcat-box/internal/tray"
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
	ctx        context.Context
	svc        *service.Service
	svcAdapter adapter.TailcatAdapter
	chat       *chat.Service
	keys       *store.Store
	tray       *tray.Controller
	trayIcon   []byte
	settings   *settings.Store
	startedAt  time.Time
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

func newAdapters() (adapter.TailcatAdapter, adapter.ChatAdapter) {
	if strings.EqualFold(os.Getenv("TAILCAT_ADAPTER"), "fake") {
		f := adapter.NewFake()
		return f, f
	}
	r := adapter.NewReal()
	return r, r
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
	ad, chatAd := newAdapters()
	svc := service.New(ad)
	if settings, err := keys.LoadSettings(); err == nil {
		svc.SetNetworkOpts(adapter.NetworkOpts{Region: settings.Region, DERPMapURL: settings.DERPMapURL})
	}
	chatSvc := chat.New(chatAd)
	chatSvc.SetDataDir(chatDataDir())
	return &App{
		svc:        svc,
		svcAdapter: ad,
		chat:       chatSvc,
		keys:       keys,
		settings:   newSettingsStore(),
		trayIcon:   tray.DefaultIcon,
		startedAt:  time.Now(),
	}
}

func chatDataDir() string {
	if dir := os.Getenv("TAILCAT_CHAT_DIR"); dir != "" {
		return dir
	}
	conf, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(".", configDirName, "chat")
	}
	return filepath.Join(conf, configDirName, "chat")
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
	for _, sess := range a.ListSessions() {
		if sess.Status != session.StatusStopped {
			n++
		}
	}
	return n
}

func (a *App) forwardEvents() {
	emit := func(ev adapter.Event) {
		if a.tray != nil {
			a.tray.Refresh()
		}
		if a.ctx == nil {
			return
		}
		runtime.EventsEmit(a.ctx, tailcatEventName, ev)
	}
	go func() {
		for ev := range a.svc.Events() {
			emit(ev)
		}
	}()
	for ev := range a.chat.Events() {
		emit(ev)
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
	material, err := a.svcAdapter.GeneratePrivateKeyJSON()
	if err != nil {
		return "", err
	}
	return a.keys.Create(name, store.CreateOpts{Client: client, Region: region, PrivateKeyJSON: material})
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
	out := a.svc.List()
	if a.chat != nil {
		if sess, ok := a.chat.Session(); ok {
			out = append(out, sess)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func roomKeyMaterial(raw []byte) (string, error) {
	var wrap struct {
		PrivateKey json.RawMessage `json:"PrivateKey"`
		Private    json.RawMessage `json:"Private"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return "", fmt.Errorf("saved key is not a Tailcat private key")
	}
	if len(wrap.PrivateKey) > 0 && string(wrap.PrivateKey) != "null" {
		return string(wrap.PrivateKey), nil
	}
	if len(wrap.Private) > 0 && string(wrap.Private) != "null" {
		return string(raw), nil
	}
	return "", fmt.Errorf("saved key is not a Tailcat private key")
}

func (a *App) chatOpts(keyName string) (chat.StartOpts, error) {
	net := a.svc.NetworkOpts()
	opts := chat.StartOpts{Region: net.Region, DERPMapURL: net.DERPMapURL, KeyName: strings.TrimSpace(keyName)}
	if opts.KeyName == "" {
		return opts, nil
	}
	raw, err := a.keys.ReadRaw(opts.KeyName)
	if err != nil {
		return chat.StartOpts{}, err
	}
	material, err := roomKeyMaterial(raw)
	if err != nil {
		return chat.StartOpts{}, err
	}
	opts.PrivateKeyJSON = material
	return opts, nil
}

func (a *App) StartChatRoom() (session.Session, error) {
	opts, err := a.chatOpts("")
	if err != nil {
		return session.Session{}, err
	}
	return a.chat.Start(opts)
}

func (a *App) ConnectChatPeer(addr string) error {
	return a.chat.Connect(addr)
}

func (a *App) SendChatText(body string, burn bool, ttlSec int) error {
	return a.chat.SendTextBurn(body, burn, ttlSec)
}

func (a *App) SendChatFile(path string, burn bool, ttlSec int) (string, error) {
	return a.chat.SendFile(path, burn, ttlSec)
}

// SendChatVoice sends a port 103 voice note. audioBase64 is standard base64 of the
// audio bytes. Burn follows the composer choice.
func (a *App) SendChatVoice(mime string, durationSec int, audioBase64 string, burn bool, ttlSec int) error {
	audio, err := decodeVoiceBase64(audioBase64)
	if err != nil {
		return err
	}
	return a.chat.SendVoice(mime, durationSec, audio, burn, ttlSec)
}

// SendChatSignal sends one port 100 WebRTC control envelope. metaJSON is the
// control object (rtc-offer, rtc-answer, or rtc-hangup). The payload is empty.
func (a *App) SendChatSignal(metaJSON string) error {
	return a.chat.SendSignal(metaJSON)
}

// DecodeChatVoice turns a voice payload the webview cannot play into WAV bytes.
// Both the input and the WAV result are standard base64 strings.
func (a *App) DecodeChatVoice(mime string, audioBase64 string) (string, error) {
	audio, err := decodeVoiceBase64(audioBase64)
	if err != nil {
		return "", err
	}
	wav, err := chat.DecodeVoiceWAV(mime, audio)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(wav), nil
}

func decodeVoiceBase64(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("voice audio is not base64: %w", err)
	}
	return raw, nil
}

func (a *App) DiscardChatMessage(id string) error {
	return a.chat.Discard(id)
}

func (a *App) ResendChatFile(id string) error {
	_, err := a.chat.Resend(id)
	return err
}

func (a *App) SaveChatFile(id string) error {
	if a.ctx == nil {
		return fmt.Errorf("save dialog requires a running window")
	}
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{DefaultFilename: a.chat.FileName(id)})
	if err != nil || dest == "" {
		return err
	}
	return a.chat.CopyFile(id, dest)
}

func (a *App) RestartChatRoom(keyName string) (session.Session, error) {
	opts, err := a.chatOpts(keyName)
	if err != nil {
		return session.Session{}, err
	}
	return a.chat.Restart(opts)
}

func (a *App) StopChatRoom() error {
	return a.chat.Stop()
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
