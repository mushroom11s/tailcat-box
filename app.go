package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"encoding/base64"
	"encoding/json"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/appinfo"
	"github.com/mushroom11s/tailcat-box/internal/autostart"
	"github.com/mushroom11s/tailcat-box/internal/chat"
	"github.com/mushroom11s/tailcat-box/internal/miao"
	"github.com/mushroom11s/tailcat-box/internal/service"
	"github.com/mushroom11s/tailcat-box/internal/session"
	"github.com/mushroom11s/tailcat-box/internal/settings"
	"github.com/mushroom11s/tailcat-box/internal/store"
	"github.com/mushroom11s/tailcat-box/internal/sysinfo"
	"github.com/mushroom11s/tailcat-box/internal/tray"
	"github.com/mushroom11s/tailcat-box/internal/update"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	tailcatEventName        = "tailcat:event"
	updateEventName         = "tailcat:update"
	updateProgressEventName = "tailcat:update-progress"
	updateCheckInterval     = 24 * time.Hour
	configDirName           = "tailcat-box"
	legacyConfigDirName     = "tailcat-desktop-client"
	// windowTitle is the native OS caption. It stays English when the UI
	// locale changes the sidebar brand and tray name.
	windowTitle = "Tailcat Box"
)

// productTitle is the tray name, and on macOS the system menu name, for a UI locale.
func productTitle(locale string) string {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "zh-cn", "zh":
		return "猫砂盆"
	default:
		return windowTitle
	}
}

// App is the Wails-bound application. The UI talks only to these methods.
type App struct {
	ctx        context.Context
	svc        *service.Service
	svcAdapter adapter.TailcatAdapter
	rooms      *chat.Manager
	miao       *miao.Service
	keys       *store.Store
	tray       *tray.Controller
	trayIcon   []byte
	settings   *settings.Store
	updates    *update.Checker
	updateMu   sync.Mutex
	uiLocale   string
	// windowFullscreen tracks the View menu label (Enter vs Exit Full Screen).
	// The native window title stays windowTitle in both states.
	windowFullscreen bool
	startedAt        time.Time
}

// ClientInfo is desktop-client metadata shown on Settings.
type ClientInfo struct {
	StartedAt       string
	AppVersion      string
	TailcatVersion  string
	LastUpdateCheck string
}

// UpdateStatus is the in-app update card: cached GitHub release plus this build.
type UpdateStatus struct {
	CurrentVersion  string
	LatestVersion   string
	LatestTag       string
	UpdateAvailable bool
	Notes           string
	ReleaseURL      string
	AssetName       string
	DownloadURL     string
	LastChecked     string
	Status          string
	Error           string
	DownloadedPath  string
	ProgressPercent int
	Platform        string
}

// UpdateProgress is emitted on tailcat:update-progress while a zip downloads.
type UpdateProgress struct {
	Received int64
	Total    int64
	Percent  int
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

// SetUILocale applies the product name and menu captions for locale to the
// tray and, on macOS, the system menu bar. The native window title stays windowTitle.
func (a *App) SetUILocale(locale string) {
	a.uiLocale = locale
	title := productTitle(locale)
	if a.tray != nil {
		a.tray.SetProductName(title, title)
		a.tray.SetLocale(locale)
	}
	if a.ctx == nil {
		return
	}
	runtime.WindowSetTitle(a.ctx, windowTitle)
	a.syncApplicationMenu(title)
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
	rooms := chat.NewManager(chatAd, chatDataDir())
	shares := miao.New(chatAd, miaoDataDir())
	return &App{
		svc:        svc,
		svcAdapter: ad,
		rooms:      rooms,
		miao:       shares,
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

func miaoDataDir() string {
	if dir := os.Getenv("TAILCAT_MIAO_DIR"); dir != "" {
		return dir
	}
	conf, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(".", configDirName, "miao")
	}
	return filepath.Join(conf, configDirName, "miao")
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.tray = tray.New(a.showWindow, a.quitApp, a.activeSessionCount)
	a.tray.SetHide(a.hideWindow)
	a.tray.SetNavigate(a.navigate)
	if a.uiLocale != "" {
		title := productTitle(a.uiLocale)
		a.tray.SetProductName(title, title)
		a.tray.SetLocale(a.uiLocale)
		a.syncApplicationMenu(title)
	}
	a.tray.Start(a.trayIcon)
	go a.forwardEvents()
	go a.maybeRecordDailyUpdateCheck()
}

func (a *App) shutdown(ctx context.Context) {
	if a.miao != nil {
		a.miao.Close()
	}
	if a.rooms != nil {
		a.rooms.StopAll()
	}
	_ = ctx
}

func (a *App) maybeRecordDailyUpdateCheck() {
	if a.settings == nil {
		return
	}
	cached := a.GetUpdateStatus()
	if cached.LastChecked != "" || cached.UpdateAvailable {
		a.emitUpdate(cached)
	}
	_, last := a.settings.Snapshot()
	if !last.IsZero() && time.Since(last) < updateCheckInterval {
		return
	}
	_, _ = a.CheckForUpdate()
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowShow(a.ctx)
}

func (a *App) hideWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowHide(a.ctx)
}

// navigate shows the window and asks the frontend to open page.
func (a *App) navigate(page string) {
	a.showWindow()
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, tray.NavigateEvent, page)
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
	if a.miao != nil {
		go func() {
			for ev := range a.miao.Events() {
				emit(ev)
			}
		}()
	}
	if a.rooms == nil {
		return
	}
	for ev := range a.rooms.Events() {
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
// When openBrowser is true, the system browser opens to the first local listener after it is ready.
func (a *App) StartForward(addr string, mappings []adapter.PortMapping, openBrowser bool) (session.Session, error) {
	return a.svc.StartForward(addr, mappings, openBrowser)
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
	if a.rooms != nil {
		out = append(out, a.rooms.Sessions()...)
	}
	if a.miao != nil {
		out = append(out, a.miao.Sessions()...)
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

func (a *App) StartChatRoom(keyName string) (session.Session, error) {
	opts, err := a.chatOpts(keyName)
	if err != nil {
		return session.Session{}, err
	}
	return a.rooms.Start(opts)
}

func (a *App) ConnectChatPeer(roomID string, addr string) error {
	return a.rooms.Connect(roomID, addr)
}

func (a *App) SendChatText(roomID string, body string, burn bool, ttlSec int) error {
	return a.rooms.SendText(roomID, body, burn, ttlSec)
}

func (a *App) SendChatFile(roomID string, path string, burn bool, ttlSec int) (string, error) {
	return a.rooms.SendFile(roomID, path, burn, ttlSec)
}

// SendChatVoice sends a port 103 voice note. audioBase64 is standard base64 of the
// audio bytes. Burn follows the composer choice.
func (a *App) SendChatVoice(roomID string, mime string, durationSec int, audioBase64 string, burn bool, ttlSec int) error {
	audio, err := decodeVoiceBase64(audioBase64)
	if err != nil {
		return err
	}
	return a.rooms.SendVoice(roomID, mime, durationSec, audio, burn, ttlSec)
}

// SendChatSignal sends one port 100 WebRTC control envelope. metaJSON is the
// control object (rtc-offer, rtc-answer, or rtc-hangup). The payload is empty.
func (a *App) SendChatSignal(roomID string, metaJSON string) error {
	return a.rooms.SendSignal(roomID, metaJSON)
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

func (a *App) DiscardChatMessage(roomID string, id string) error {
	return a.rooms.Discard(roomID, id)
}

func (a *App) ResendChatFile(roomID string, id string) error {
	return a.rooms.Resend(roomID, id)
}

func (a *App) SaveChatFile(roomID string, id string) error {
	if a.ctx == nil {
		return fmt.Errorf("save dialog requires a running window")
	}
	name, err := a.rooms.FileName(roomID, id)
	if err != nil {
		return err
	}
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{DefaultFilename: name})
	if err != nil || dest == "" {
		return err
	}
	return a.rooms.CopyFile(roomID, id, dest)
}

func (a *App) RestartChatRoom(roomID string, keyName string) (session.Session, error) {
	if strings.TrimSpace(roomID) == "" {
		return session.Session{}, chat.ErrNoRoom
	}
	opts, err := a.chatOpts(keyName)
	if err != nil {
		return session.Session{}, err
	}
	sess, err := a.rooms.Restart(roomID, opts)
	if sess.ID != "" {
		return sess, nil
	}
	return sess, err
}

func (a *App) StopChatRoom(roomID string) error {
	return a.rooms.Stop(roomID)
}

// MiaoFileInput is one file for a 喵传 share. Path is a local file. DataBase64 is used when Path is empty.
type MiaoFileInput struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	DataBase64 string `json:"dataBase64"`
}

// StartMiaoShare copies files into app temp, listens on Tailcat, and returns the join payload.
// forever ignores ttlDays. maxDownloads 0 means unlimited.
func (a *App) StartMiaoShare(files []MiaoFileInput, ttlDays int, forever bool, maxDownloads int) (miao.Snapshot, error) {
	if a.miao == nil {
		return miao.Snapshot{}, fmt.Errorf("share storage is not configured")
	}
	sources := make([]miao.Source, 0, len(files))
	for _, file := range files {
		src := miao.Source{Name: file.Name, Path: strings.TrimSpace(file.Path)}
		if src.Path == "" && file.DataBase64 != "" {
			raw, err := base64.StdEncoding.DecodeString(file.DataBase64)
			if err != nil {
				return miao.Snapshot{}, fmt.Errorf("file data is not base64")
			}
			src.Data = raw
		}
		sources = append(sources, src)
	}
	lim := miao.Limits{MaxDownloads: maxDownloads}
	if forever {
		lim.TTLDays = 0
	} else {
		if ttlDays < 1 || ttlDays > 3650 {
			return miao.Snapshot{}, miao.ErrBadDays
		}
		lim.TTLDays = ttlDays
		lim.TTL = time.Duration(ttlDays) * 24 * time.Hour
	}
	net := adapter.NetworkOpts{}
	if a.svc != nil {
		net = a.svc.NetworkOpts()
	}
	return a.miao.Start(sources, lim, net)
}

// EndMiaoShare stops the share and deletes its temp copies.
func (a *App) EndMiaoShare(id string) error {
	if a.miao == nil {
		return fmt.Errorf("Unknown share.")
	}
	return a.miao.End(id)
}

// MiaoShareStatus returns every share that is still listening.
func (a *App) MiaoShareStatus() []miao.Snapshot {
	if a.miao == nil {
		return []miao.Snapshot{}
	}
	list := a.miao.List()
	if list == nil {
		return []miao.Snapshot{}
	}
	return list
}

// JoinMiaoShare downloads a share into destDir. The host must stay online.
func (a *App) JoinMiaoShare(payload string, destDir string) (miao.Receipt, error) {
	if a.miao == nil {
		return miao.Receipt{}, fmt.Errorf("share storage is not configured")
	}
	net := adapter.NetworkOpts{}
	if a.svc != nil {
		net = a.svc.NetworkOpts()
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	defer cancel()
	return a.miao.Join(ctx, payload, destDir, net)
}

// StartMiaoReceive begins a download and returns immediately.
// Progress arrives as tailcat events with Kind "miao-receive".
func (a *App) StartMiaoReceive(payload string, destDir string) (miao.ReceiveJob, error) {
	if a.miao == nil {
		return miao.ReceiveJob{}, fmt.Errorf("share storage is not configured")
	}
	net := adapter.NetworkOpts{}
	if a.svc != nil {
		net = a.svc.NetworkOpts()
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	return a.miao.StartReceive(parent, payload, destDir, net)
}

// CancelMiaoReceive stops a download that is still in progress.
func (a *App) CancelMiaoReceive(id string) error {
	if a.miao == nil {
		return miao.ErrUnknownReceive
	}
	return a.miao.CancelReceive(id)
}

// ListMiaoReceives returns in-progress downloads and partials kept after a quit.
func (a *App) ListMiaoReceives() ([]miao.ReceiveJob, error) {
	if a.miao == nil {
		return []miao.ReceiveJob{}, nil
	}
	return a.miao.ListReceives(), nil
}

// DiscardMiaoReceive deletes a failed or interrupted download and its partial files.
func (a *App) DiscardMiaoReceive(id string) error {
	if a.miao == nil {
		return miao.ErrUnknownReceive
	}
	return a.miao.DiscardReceive(id)
}

// SetMiaoReceiveDest changes the save folder before files start writing.
func (a *App) SetMiaoReceiveDest(id string, destDir string) error {
	if a.miao == nil {
		return miao.ErrUnknownReceive
	}
	return a.miao.SetReceiveDest(id, destDir)
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

// RecordUpdateCheck runs a real GitHub release check and returns client info.
// Prefer CheckForUpdate when the caller needs the update card.
func (a *App) RecordUpdateCheck() (ClientInfo, error) {
	if _, err := a.CheckForUpdate(); err != nil {
		return a.GetClientInfo(), err
	}
	return a.GetClientInfo(), nil
}

// GetUpdateStatus returns the persisted update card without contacting GitHub.
func (a *App) GetUpdateStatus() UpdateStatus {
	var st settings.UpdateState
	if a.settings != nil {
		st = a.settings.UpdateState()
	}
	return composeUpdateStatus(st, appinfo.ClientVersion(), goruntime.GOOS)
}

// CheckForUpdate fetches the latest stable GitHub Release and stores the result.
func (a *App) CheckForUpdate() (UpdateStatus, error) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.settings == nil {
		return UpdateStatus{}, fmt.Errorf("settings store is not available")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result := a.checkerLocked().Check(ctx)
	next := foldUpdateResult(a.settings.UpdateState(), result, time.Now())
	if err := a.settings.SetUpdateState(next); err != nil {
		return composeUpdateStatus(a.settings.UpdateState(), appinfo.ClientVersion(), goruntime.GOOS), err
	}
	status := composeUpdateStatus(a.settings.UpdateState(), appinfo.ClientVersion(), goruntime.GOOS)
	a.emitUpdate(status)
	return status, nil
}

// DownloadUpdate writes the stored release zip into the Downloads folder.
func (a *App) DownloadUpdate() (UpdateStatus, error) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.settings == nil {
		return UpdateStatus{}, fmt.Errorf("settings store is not available")
	}
	st := a.settings.UpdateState()
	status := composeUpdateStatus(st, appinfo.ClientVersion(), goruntime.GOOS)
	if !status.UpdateAvailable || st.DownloadURL == "" || st.AssetName == "" {
		return status, fmt.Errorf("no update to download")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	path, err := a.checkerLocked().Download(ctx, st.DownloadURL, st.AssetName, func(p update.Progress) {
		a.emitProgress(UpdateProgress{Received: p.Received, Total: p.Total, Percent: p.Percent})
	})
	if err != nil {
		status.Error = update.ErrDownload
		status.Status = update.StatusAvailable
		status.UpdateAvailable = true
		status.DownloadedPath = ""
		a.emitUpdate(status)
		return status, nil
	}
	st.DownloadedPath = path
	st.Status = update.StatusDownloaded
	st.Error = ""
	if err := a.settings.SetUpdateState(st); err != nil {
		return composeUpdateStatus(a.settings.UpdateState(), appinfo.ClientVersion(), goruntime.GOOS), err
	}
	status = composeUpdateStatus(a.settings.UpdateState(), appinfo.ClientVersion(), goruntime.GOOS)
	status.ProgressPercent = 100
	a.emitUpdate(status)
	return status, nil
}

// RevealDownloadedUpdate shows the downloaded zip in Finder or Explorer.
func (a *App) RevealDownloadedUpdate() error {
	status := a.GetUpdateStatus()
	if status.DownloadedPath == "" {
		return fmt.Errorf("no downloaded update")
	}
	if !fileExists(status.DownloadedPath) {
		return fmt.Errorf("downloaded update is missing")
	}
	return update.Reveal(status.DownloadedPath)
}

func (a *App) checkerLocked() *update.Checker {
	if a.updates != nil {
		return a.updates
	}
	a.updates = update.New(update.Config{
		CurrentVersion: appinfo.ClientVersion(),
		LatestURL:      os.Getenv("TAILCAT_UPDATE_URL"),
		DownloadsDir:   os.Getenv("TAILCAT_DOWNLOADS_DIR"),
		GOOS:           goruntime.GOOS,
		GOARCH:         goruntime.GOARCH,
		UserAgent:      update.UserAgent(appinfo.ClientVersion()),
	})
	return a.updates
}

func (a *App) emitUpdate(status UpdateStatus) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, updateEventName, status)
}

func (a *App) emitProgress(progress UpdateProgress) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, updateProgressEventName, progress)
}

func foldUpdateResult(prev settings.UpdateState, result update.Result, now time.Time) settings.UpdateState {
	next := prev
	next.CheckedAt = now.UTC()
	if result.Status == update.StatusError {
		next.Status = update.StatusError
		next.Error = result.Error
		return next
	}
	next.Status = result.Status
	next.Error = result.Error
	next.LatestTag = result.LatestTag
	next.LatestVersion = result.LatestVersion
	next.ReleaseURL = result.ReleaseURL
	next.Notes = result.Notes
	next.AssetName = result.AssetName
	next.DownloadURL = result.DownloadURL
	if result.AssetName == "" || result.AssetName != prev.AssetName {
		next.DownloadedPath = ""
	}
	if next.Status == update.StatusUpToDate || next.Status == update.StatusUnsupported {
		next.DownloadedPath = ""
	}
	if next.Status == update.StatusAvailable && next.DownloadedPath != "" && fileExists(next.DownloadedPath) {
		next.Status = update.StatusDownloaded
	}
	return next
}

func composeUpdateStatus(st settings.UpdateState, current, goos string) UpdateStatus {
	out := UpdateStatus{
		CurrentVersion: current,
		LatestVersion:  st.LatestVersion,
		LatestTag:      st.LatestTag,
		Notes:          st.Notes,
		ReleaseURL:     st.ReleaseURL,
		AssetName:      st.AssetName,
		DownloadURL:    st.DownloadURL,
		DownloadedPath: st.DownloadedPath,
		Status:         st.Status,
		Error:          st.Error,
		Platform:       goos,
	}
	if !st.CheckedAt.IsZero() {
		out.LastChecked = st.CheckedAt.UTC().Format(time.RFC3339)
	}
	switch st.Status {
	case update.StatusAvailable, update.StatusDownloaded:
		newer, err := update.IsNewer(st.LatestVersion, current)
		if err != nil || !newer || st.DownloadURL == "" {
			if err == nil && !newer {
				out.Status = update.StatusUpToDate
				out.DownloadedPath = ""
			}
			return out
		}
		if st.Status == update.StatusDownloaded && !fileExists(st.DownloadedPath) {
			out.Status = update.StatusAvailable
			out.DownloadedPath = ""
		}
		out.UpdateAvailable = true
	}
	return out
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info != nil && !info.IsDir()
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
