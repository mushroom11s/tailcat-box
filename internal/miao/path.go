package miao

import (
	"context"
	"strings"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func watchPeerPath(ctx context.Context, room adapter.Room, peer string, on func(string)) {
	if room == nil || on == nil || strings.TrimSpace(peer) == "" {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	updates := room.WatchPeerPath(ctx, peer)
	go func() {
		for path := range updates {
			on(path.Kind)
		}
	}()
}

func (s *Service) noteReceivePath(run *receiveRun, gen int, kind string) {
	if !knownPeerPath(kind) || run == nil {
		return
	}
	run.mu.Lock()
	if run.gen != gen || receiveTerminal(run.job.Status) || run.job.PeerPath == kind {
		run.mu.Unlock()
		return
	}
	run.job.PeerPath = kind
	snap := run.snapshotLocked()
	run.mu.Unlock()
	s.publishReceive(snap, false)
}

func (h *host) notePath(gen int, kind string) {
	if !knownPeerPath(kind) {
		return
	}
	h.pathMu.Lock()
	defer h.pathMu.Unlock()
	h.mu.Lock()
	if h.ended || !h.sending || h.sendGen != gen || h.path == kind {
		h.mu.Unlock()
		return
	}
	h.path = kind
	snap := h.snapshotLocked()
	h.mu.Unlock()
	h.publish(snap)
}

func knownPeerPath(kind string) bool {
	return kind == adapter.PathChecking || kind == adapter.PathDirect || kind == adapter.PathDERP
}
