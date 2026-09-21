package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/service"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
	"github.com/mushroom11s/tailcat-desktop-client/internal/store"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const tailcatEventName = "tailcat:event"

// App is the Wails-bound application. The UI talks only to these methods.
type App struct {
	ctx  context.Context
	svc  *service.Service
	keys *store.Store
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
	conf, err := os.UserConfigDir()
	if err != nil {
		return store.New("keys")
	}
	s := store.New(filepath.Join(conf, "tailcat-desktop-client", "keys"))
	s.ExtraDir = filepath.Join(conf, "tailcat", "keys")
	return s
}

// NewApp creates a new App application struct.
// The default adapter is the embedded Tailcat library; set TAILCAT_ADAPTER=fake
// for offline UI demos and tests.
func NewApp() *App {
	return &App{
		svc:  service.New(newAdapter()),
		keys: newKeyStore(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.forwardEvents()
}

func (a *App) forwardEvents() {
	for ev := range a.svc.Events() {
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
