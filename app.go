package main

import (
	"context"
	"fmt"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/service"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const tailcatEventName = "tailcat:event"

// App is the Wails-bound application. The UI talks only to these methods.
type App struct {
	ctx context.Context
	svc *service.Service
}

// NewApp creates a new App application struct backed by the fake Tailcat adapter.
// Task 7 switches the default to the real library with a TAILCAT_ADAPTER=fake override.
func NewApp() *App {
	return &App{
		svc: service.New(adapter.NewFake()),
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

// StopSession stops a running session.
func (a *App) StopSession(id string) error {
	return a.svc.Stop(id)
}

// ListSessions returns a snapshot of all sessions.
func (a *App) ListSessions() []session.Session {
	return a.svc.List()
}
