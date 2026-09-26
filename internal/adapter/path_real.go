package adapter

import (
	"context"
	"fmt"
	"time"

	"tailscale.com/ipn/ipnstate"
)

// WatchPeerPath observes the session path to peer without blocking the caller.
// Inbound peer status and disco pings are merged. Direct wins when it is available.
// A transfer must not wait on this channel: the first value is checking, and a DERP
// result is published as soon as that is the best known path.
func (r *realRoom) WatchPeerPath(ctx context.Context, peer string) <-chan PeerPath {
	ch := make(chan PeerPath, 4)
	go r.watchPeerPath(ctx, peer, ch)
	return ch
}

func (r *realRoom) watchPeerPath(ctx context.Context, peer string, ch chan PeerPath) {
	defer close(ch)
	send := func(p PeerPath) bool {
		select {
		case <-ctx.Done():
			return false
		case ch <- p:
			return true
		}
	}
	if !send(PeerPath{Kind: PathChecking}) {
		return
	}

	discoCh := make(chan PeerPath, 1)
	if peer != "" {
		go r.discoProbe(ctx, peer, discoCh)
	}

	var status PeerPath
	var disco PeerPath
	published := PeerPath{Kind: PathChecking}
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	publish := func() bool {
		next := MergePeerPath(status, disco)
		if next.Kind == published.Kind && next.Detail == published.Detail {
			return true
		}
		published = next
		return send(next)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case p := <-discoCh:
			disco = p
			if !publish() {
				return
			}
		case <-ticker.C:
			status = r.sessionPath()
			if !publish() {
				return
			}
		}
	}
}

func (r *realRoom) discoProbe(ctx context.Context, peer string, out chan<- PeerPath) {
	cl := r.real.newClient(peer)
	defer cl.Close()
	var last PeerPath
	for ctx.Err() == nil {
		pingCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		res, err := cl.DiscoPing(pingCtx)
		cancel()
		if err == nil && res != nil {
			next := classifyDiscoResult(res)
			if next.Kind != last.Kind || next.Detail != last.Detail {
				last = next
				select {
				case out <- next:
				case <-ctx.Done():
					return
				}
			}
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func classifyDiscoResult(res *ipnstate.PingResult) PeerPath {
	if res == nil {
		return PeerPath{Kind: PathChecking}
	}
	id := ""
	if res.DERPRegionID != 0 {
		id = fmt.Sprintf("%v", res.DERPRegionID)
	}
	return ClassifyDisco(res.Endpoint, res.DERPRegionCode, id)
}

func (r *realRoom) sessionPath() (path PeerPath) {
	defer func() { _ = recover() }()
	r.mu.Lock()
	srv := r.srv
	done := r.done
	r.mu.Unlock()
	if done || srv == nil {
		return PeerPath{Kind: PathChecking}
	}
	st := srv.Status()
	if st == nil {
		return PeerPath{Kind: PathChecking}
	}
	best := PeerPath{Kind: PathChecking}
	for _, ps := range st.Peer {
		if ps == nil {
			continue
		}
		got := ClassifySessionPath(ps.CurAddr, ps.Relay, ps.PeerRelay)
		best = MergePeerPath(best, got)
		if best.Kind == PathDirect {
			return best
		}
	}
	return best
}
