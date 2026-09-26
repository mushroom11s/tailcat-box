package miao

import (
	"context"
	"strings"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func watchPeerPath(ctx context.Context, room adapter.Room, peer string, on func(adapter.PeerPath)) {
	if room == nil || on == nil || strings.TrimSpace(peer) == "" {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	updates := room.WatchPeerPath(ctx, peer)
	go func() {
		for path := range updates {
			on(path)
		}
	}()
}

func relayFields(path adapter.PeerPath) (kind, source, name string) {
	kind = path.Kind
	if kind != adapter.PathDERP {
		return kind, "", ""
	}
	return kind, path.RelaySource, path.RelayName
}

func (s *Service) noteReceivePath(run *receiveRun, gen int, path adapter.PeerPath) {
	kind, source, name := relayFields(path)
	if !knownPeerPath(kind) || run == nil {
		return
	}
	run.mu.Lock()
	if run.gen != gen || receiveTerminal(run.job.Status) || (run.job.PeerPath == kind && run.job.RelaySource == source && run.job.RelayName == name) {
		run.mu.Unlock()
		return
	}
	run.job.PeerPath = kind
	run.job.RelaySource = source
	run.job.RelayName = name
	snap := run.snapshotLocked()
	run.mu.Unlock()
	s.publishReceive(snap, false)
}

func (h *host) notePath(gen int, path adapter.PeerPath) {
	kind, source, name := relayFields(path)
	if !knownPeerPath(kind) {
		return
	}
	h.pathMu.Lock()
	defer h.pathMu.Unlock()
	h.mu.Lock()
	if h.ended || !h.sending || h.sendGen != gen || (h.path == kind && h.relaySource == source && h.relayName == name) {
		h.mu.Unlock()
		return
	}
	h.path = kind
	h.relaySource = source
	h.relayName = name
	snap := h.snapshotLocked()
	h.mu.Unlock()
	h.publish(snap)
}

func knownPeerPath(kind string) bool {
	return kind == adapter.PathChecking || kind == adapter.PathDirect || kind == adapter.PathDERP
}
