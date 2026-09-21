package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/browser"
	"github.com/tailscale/tailcat"
)

func (r *Real) StartPortServe(ctx context.Context, sessionID string, mappings []PortMapping) (<-chan Event, error) {
	if len(mappings) == 0 {
		return nil, fmt.Errorf("at least one port mapping is required")
	}
	ch := make(chan Event, 16)
	stop := make(chan struct{})

	r.mu.Lock()
	if existing, ok := r.serves[sessionID]; ok {
		close(existing.stop)
		if existing.server != nil {
			_ = existing.server.Close()
		}
	}
	run := &serveRun{stop: stop}
	r.serves[sessionID] = run
	r.mu.Unlock()

	go r.runPortServe(ctx, sessionID, run, mappings, ch)
	return ch, nil
}

func (r *Real) runPortServe(ctx context.Context, sessionID string, run *serveRun, mappings []PortMapping, ch chan Event) {
	var sendMu sync.Mutex
	closed := false
	send := func(ev Event) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if closed {
			return
		}
		select {
		case ch <- ev:
		default:
		}
	}
	finish := func(ev Event) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if closed {
			return
		}
		select {
		case ch <- ev:
		default:
		}
		closed = true
		close(ch)
	}
	defer func() {
		r.mu.Lock()
		if current, ok := r.serves[sessionID]; ok && current == run {
			delete(r.serves, sessionID)
		}
		r.mu.Unlock()
		finish(Event{SessionID: sessionID, Kind: EventClosed})
	}()

	byPort := map[uint16]PortMapping{}
	for _, m := range mappings {
		if m.LocalPort == 0 {
			send(Event{SessionID: sessionID, Kind: EventError, Err: "port serve requires a non-zero local port"})
			return
		}
		byPort[m.LocalPort] = m
	}

	srv := &tailcat.Server{
		Logf: func(string, ...any) {},
		OnTCP: func(port uint16) func(net.Conn) {
			m, ok := byPort[port]
			if !ok {
				return nil
			}
			host, dest := m.destHost(), m.destPort()
			target := net.JoinHostPort(host, strconv.Itoa(int(dest)))
			return func(c net.Conn) {
				local, err := net.Dial("tcp", target)
				if err != nil {
					send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
					_ = c.Close()
					return
				}
				tailcat.ProxyConns(c, local)
			}
		},
	}
	r.applyServerNet(ctx, srv)
	if err := srv.Start(); err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}

	r.mu.Lock()
	run.server = srv
	r.mu.Unlock()

	send(Event{
		SessionID: sessionID,
		Kind:      EventReady,
		Address:   string(srv.TailcatAddr()),
	})

	select {
	case <-ctx.Done():
	case <-run.stop:
	}
	_ = srv.Close()
}

func (r *Real) StartForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping) (<-chan Event, error) {
	return r.startForward(ctx, sessionID, serverAddr, mappings, false)
}

func (r *Real) StartBrowse(ctx context.Context, sessionID string, serverAddr string) (<-chan Event, error) {
	return r.startForward(ctx, sessionID, serverAddr, []PortMapping{{LocalPort: 0, RemotePort: 80}}, true)
}

func (r *Real) startForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping, browse bool) (<-chan Event, error) {
	if strings.TrimSpace(serverAddr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	if len(mappings) == 0 {
		return nil, fmt.Errorf("at least one port mapping is required")
	}

	ch := make(chan Event, 16)
	stop := make(chan struct{})
	ctx, cancel := context.WithCancel(ctx)
	run := &forwardRun{stop: stop, cancel: cancel}

	r.mu.Lock()
	if existing, ok := r.forwards[sessionID]; ok {
		close(existing.stop)
		if existing.cancel != nil {
			existing.cancel()
		}
	}
	r.forwards[sessionID] = run
	r.mu.Unlock()

	go func() {
		defer cancel()
		defer func() {
			r.mu.Lock()
			if current, ok := r.forwards[sessionID]; ok && current == run {
				delete(r.forwards, sessionID)
			}
			r.mu.Unlock()
			select {
			case ch <- Event{SessionID: sessionID, Kind: EventClosed}:
			default:
			}
			close(ch)
		}()

		cl := r.newClient(serverAddr)
		run.client = cl

		var addrs []string
		for _, mapping := range mappings {
			ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(int(mapping.LocalPort))))
			if err != nil {
				select {
				case ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}:
				default:
				}
				_ = cl.Close()
				return
			}
			run.listeners = append(run.listeners, ln)
			addrs = append(addrs, ln.Addr().String())
			go r.serveForwardListener(ctx, cl, ln, mapping)
		}

		readyAddr := strings.Join(addrs, ", ")
		if browse && len(run.listeners) > 0 {
			hostport := run.listeners[0].Addr().String()
			if ap, err := netip.ParseAddrPort(hostport); err == nil && ap.Addr().IsUnspecified() {
				hostport = net.JoinHostPort("127.0.0.1", strconv.Itoa(int(ap.Port())))
			}
			url := "http://" + hostport + "/"
			readyAddr = url
			_ = browser.OpenURL(url)
		}

		select {
		case ch <- Event{SessionID: sessionID, Kind: EventReady, Address: readyAddr, Data: readyAddr}:
		default:
		}

		select {
		case <-ctx.Done():
		case <-stop:
		}
		for _, ln := range run.listeners {
			_ = ln.Close()
		}
		_ = cl.Close()
	}()

	return ch, nil
}

func (r *Real) serveForwardListener(ctx context.Context, cl *tailcat.Client, ln net.Listener, mapping PortMapping) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			remote, err := dialMapping(ctx, cl, mapping)
			if err != nil {
				return
			}
			tailcat.ProxyConns(c, remote)
		}(conn)
	}
}

func dialMapping(ctx context.Context, cl *tailcat.Client, m PortMapping) (net.Conn, error) {
	port := m.destPort()
	host := m.RemoteHost
	if host == "" || host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return cl.DialTCPPort(ctx, port)
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return nil, err
	}
	return cl.DialTCP(ctx, netip.AddrPortFrom(ip, port))
}

func (r *Real) StartPing(ctx context.Context, sessionID string, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error) {
	if strings.TrimSpace(addr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ch := make(chan Event, 16)
	ctx, cancel := context.WithCancel(ctx)

	r.mu.Lock()
	if prev, ok := r.cancels[sessionID]; ok {
		prev()
	}
	r.cancels[sessionID] = cancel
	r.mu.Unlock()

	go func() {
		defer cancel()
		defer close(ch)
		defer func() {
			r.mu.Lock()
			delete(r.cancels, sessionID)
			r.mu.Unlock()
		}()

		cl := r.newClient(addr)
		defer cl.Close()

		deadline := time.Now().Add(timeout)
		for {
			t0 := time.Now()
			pingCtx, pingCancel := context.WithDeadline(ctx, deadline)
			res, err := cl.DiscoPing(pingCtx)
			pingCancel()
			if err != nil {
				ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
				return
			}
			latency := time.Duration(res.LatencySeconds * float64(time.Second)).Round(10 * time.Microsecond)
			direct := res.Endpoint != ""
			via := res.Endpoint
			if !direct {
				via = fmt.Sprintf("DERP(%v)", res.DERPRegionCode)
				if res.DERPRegionCode == "" {
					via = fmt.Sprintf("DERP(%v)", res.DERPRegionID)
				}
			}
			ch <- Event{SessionID: sessionID, Kind: EventData, Data: fmt.Sprintf("pong in %v via %v", latency, via)}
			if direct || !untilDirect {
				ch <- Event{SessionID: sessionID, Kind: EventClosed}
				return
			}
			if time.Until(deadline) < time.Second/2 {
				ch <- Event{SessionID: sessionID, Kind: EventError, Err: fmt.Sprintf("no direct path after %v", timeout)}
				return
			}
			select {
			case <-ctx.Done():
				ch <- Event{SessionID: sessionID, Kind: EventClosed}
				return
			case <-time.After(max(0, time.Second-time.Since(t0))):
			}
		}
	}()

	return ch, nil
}

func (r *Real) ParseAddr(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	v, err := tailcat.ParseAddrRaw(tailcat.Addr(raw))
	if err != nil {
		return "", err
	}
	body, err := json.MarshalIndent(v, "", "    ")
	if err != nil {
		return "", err
	}
	return string(body) + "\n", nil
}

func (r *Real) ResolveAddr(ctx context.Context, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	resolved, err := tailcat.Addr(raw).Resolve(ctx)
	if err != nil {
		return "", err
	}
	return string(resolved), nil
}
