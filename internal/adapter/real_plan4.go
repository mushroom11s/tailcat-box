package adapter

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	osuser "os/user"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tailscale/tailcat"
	gossh "golang.org/x/crypto/ssh"
	"tailscale.com/net/socks5"
	"tailscale.com/tailcfg"
	"tailscale.com/types/logger"
)

const SSHPort uint16 = 22

func (r *Real) SetNetworkOpts(opts NetworkOpts) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.net = opts
}

func (r *Real) NetworkOpts() NetworkOpts {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.net
}

func (r *Real) applyServerNet(ctx context.Context, srv *tailcat.Server) {
	opts := r.NetworkOpts()
	if opts.DERPMapURL != "" {
		srv.DERPMapURL = opts.DERPMapURL
	}
	if rid := r.resolveRegionID(ctx, opts); rid != 0 {
		srv.RegionID = tailcfg.DERPRegionID(rid)
	}
}

func (r *Real) applyClientNet(cl *tailcat.Client) {
	opts := r.NetworkOpts()
	if opts.DERPMapURL != "" {
		cl.DERPMapURL = opts.DERPMapURL
	}
}

func (r *Real) newClient(addr string) *tailcat.Client {
	cl := tailcat.NewClient(tailcat.Addr(addr))
	cl.Logf = func(string, ...any) {}
	r.applyClientNet(cl)
	return cl
}

func (r *Real) resolveRegionID(ctx context.Context, opts NetworkOpts) int {
	region := strings.TrimSpace(opts.Region)
	if region == "" || strings.EqualFold(region, "auto") {
		return 0
	}
	if n, err := strconv.Atoi(region); err == nil && n != 0 {
		return n
	}
	fetchOpts := []any{}
	if opts.DERPMapURL != "" {
		fetchOpts = append(fetchOpts, tailcat.DERPMapURL(opts.DERPMapURL))
	}
	dm, err := tailcat.FetchDERPMap(ctx, fetchOpts...)
	if err != nil || dm == nil {
		return 0
	}
	for _, reg := range dm.Regions {
		if strings.EqualFold(reg.RegionCode, region) {
			return int(reg.RegionID)
		}
	}
	for _, reg := range dm.Regions {
		if strings.Contains(strings.ToLower(reg.RegionName), strings.ToLower(region)) {
			return int(reg.RegionID)
		}
	}
	return 0
}

func (r *Real) StartSSHServe(ctx context.Context, sessionID string, opts SSHServeOpts) (<-chan Event, error) {
	if !opts.NoAuth && strings.TrimSpace(opts.AuthorizedKeys) == "" {
		return nil, fmt.Errorf("authorized keys are required for keyed SSH (or use no-auth with confirmation)")
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

	go r.runSSHServe(ctx, sessionID, opts, run, ch)
	return ch, nil
}

func (r *Real) runSSHServe(ctx context.Context, sessionID string, opts SSHServeOpts, run *serveRun, ch chan Event) {
	send, finish := serveEventPair(ch)
	defer func() {
		r.dropServe(sessionID, run)
		finish(Event{SessionID: sessionID, Kind: EventClosed})
	}()

	sshOpts := tailcat.SSHOptions{Shell: true}
	if !opts.NoAuth {
		keys, err := loadAuthorizedKeys(opts.AuthorizedKeys)
		if err != nil {
			send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
			return
		}
		sshOpts.AuthorizedKeys = keys
	}

	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	r.applyServerNet(ctx, srv)
	handler := srv.SSHConnHandler(sshOpts)
	srv.OnTCP = func(port uint16) func(net.Conn) {
		if port != SSHPort {
			return nil
		}
		return handler
	}
	if err := srv.Start(); err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}
	r.mu.Lock()
	run.server = srv
	r.mu.Unlock()
	send(Event{SessionID: sessionID, Kind: EventReady, Address: string(srv.TailcatAddr())})
	select {
	case <-ctx.Done():
	case <-run.stop:
	}
	_ = srv.Close()
}

func (r *Real) StartExitNode(ctx context.Context, sessionID string) (<-chan Event, error) {
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
	go r.runExitNode(ctx, sessionID, run, ch)
	return ch, nil
}

func (r *Real) runExitNode(ctx context.Context, sessionID string, run *serveRun, ch chan Event) {
	send, finish := serveEventPair(ch)
	defer func() {
		r.dropServe(sessionID, run)
		finish(Event{SessionID: sessionID, Kind: EventClosed})
	}()

	tcpForward := func(dst string) func(net.Conn) {
		return func(c net.Conn) {
			local, err := net.Dial("tcp", dst)
			if err != nil {
				send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
				_ = c.Close()
				return
			}
			tailcat.ProxyConns(c, local)
		}
	}
	udpForward := func(dst netip.AddrPort) func(tailcat.ConnPacketConn) {
		return func(c tailcat.ConnPacketConn) {
			local, err := net.DialUDP("udp", nil, net.UDPAddrFromAddrPort(dst))
			if err != nil {
				send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
				_ = c.Close()
				return
			}
			tailcat.ProxyPacketConns(c, local)
		}
	}

	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	r.applyServerNet(ctx, srv)
	srv.OnTCPForward = func(dst netip.AddrPort) func(net.Conn) {
		return tcpForward(dst.String())
	}
	srv.OnUDPForward = func(dst netip.AddrPort) func(tailcat.ConnPacketConn) {
		return udpForward(dst)
	}
	srv.OnTCP = func(port uint16) func(net.Conn) {
		return tcpForward(fmt.Sprintf("localhost:%d", port))
	}
	if err := srv.Start(); err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}
	r.mu.Lock()
	run.server = srv
	r.mu.Unlock()
	send(Event{SessionID: sessionID, Kind: EventReady, Address: string(srv.TailcatAddr())})
	select {
	case <-ctx.Done():
	case <-run.stop:
	}
	_ = srv.Close()
}

func (r *Real) StartExec(ctx context.Context, sessionID string, argv []string) (<-chan Event, error) {
	if len(argv) == 0 || strings.TrimSpace(argv[0]) == "" {
		return nil, fmt.Errorf("command is required")
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
	go r.runExec(ctx, sessionID, argv, run, ch)
	return ch, nil
}

func (r *Real) runExec(ctx context.Context, sessionID string, argv []string, run *serveRun, ch chan Event) {
	send, finish := serveEventPair(ch)
	defer func() {
		r.dropServe(sessionID, run)
		finish(Event{SessionID: sessionID, Kind: EventClosed})
	}()

	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	r.applyServerNet(ctx, srv)
	handler := srv.ExecConnHandler(argv)
	srv.OnTCP = func(port uint16) func(net.Conn) {
		return handler
	}
	if err := srv.Start(); err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}
	r.mu.Lock()
	run.server = srv
	r.mu.Unlock()
	send(Event{SessionID: sessionID, Kind: EventReady, Address: string(srv.TailcatAddr())})
	select {
	case <-ctx.Done():
	case <-run.stop:
	}
	_ = srv.Close()
}

func (r *Real) StartSSHClient(ctx context.Context, sessionID string, serverAddr string, opts SSHClientOpts) (<-chan Event, error) {
	if strings.TrimSpace(serverAddr) == "" {
		return nil, fmt.Errorf("address is required")
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

		cl := r.newClient(serverAddr)
		defer cl.Close()
		conn, err := cl.DialTCPPort(ctx, SSHPort)
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		user := strings.TrimSpace(opts.User)
		if user == "" {
			if u, err := osuser.Current(); err == nil && u.Username != "" {
				user = u.Username
			} else {
				user = "tailcat"
			}
		}
		cfg := &gossh.ClientConfig{
			User:            user,
			HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		}
		if ident := strings.TrimSpace(opts.Identity); ident != "" {
			signer, err := loadSSHIdentity(ident)
			if err != nil {
				_ = conn.Close()
				ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
				return
			}
			cfg.Auth = []gossh.AuthMethod{gossh.PublicKeys(signer)}
		}
		sshConn, chans, reqs, err := gossh.NewClientConn(conn, "tailcat", cfg)
		if err != nil {
			_ = conn.Close()
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		client := gossh.NewClient(sshConn, chans, reqs)
		defer client.Close()

		sess, err := client.NewSession()
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		defer sess.Close()
		cmd := strings.TrimSpace(opts.Command)
		if cmd == "" {
			cmd = "whoami"
		}
		out, err := sess.CombinedOutput(cmd)
		if len(out) > 0 {
			ch <- Event{SessionID: sessionID, Kind: EventData, Data: strings.TrimSpace(string(out))}
		}
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (r *Real) StartSOCKS(ctx context.Context, sessionID string, serverAddr string, listen string) (<-chan Event, error) {
	if strings.TrimSpace(serverAddr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	if strings.TrimSpace(listen) == "" {
		listen = "127.0.0.1:0"
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
		ln, err := net.Listen("tcp", listen)
		if err != nil {
			select {
			case ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}:
			default:
			}
			_ = cl.Close()
			return
		}
		run.listeners = append(run.listeners, ln)
		ss := &socks5.Server{
			Logf: logger.Discard,
			Dialer: func(dctx context.Context, network, addr string) (net.Conn, error) {
				dctx, dcancel := context.WithTimeout(context.WithoutCancel(dctx), 15*time.Second)
				defer dcancel()
				return dialSOCKS(dctx, network, addr, cl)
			},
		}
		ready := "socks5h://" + ln.Addr().String()
		select {
		case ch <- Event{SessionID: sessionID, Kind: EventReady, Address: ready, Data: ready}:
		default:
		}
		go func() {
			_ = ss.Serve(ln)
		}()
		select {
		case <-ctx.Done():
		case <-stop:
		}
		_ = ln.Close()
		_ = cl.Close()
	}()
	return ch, nil
}

func dialSOCKS(ctx context.Context, network, addr string, cl *tailcat.Client) (net.Conn, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	port64, err := strconv.ParseUint(portStr, 10, 16)
	if err != nil {
		return nil, err
	}
	port := uint16(port64)
	udp := strings.HasPrefix(network, "udp")

	if _, err := tailcat.ParseAddr(tailcat.Addr(host)); err == nil {
		peer := tailcat.NewClient(tailcat.Addr(host))
		peer.Logf = func(string, ...any) {}
		if cl.DERPMapURL != "" {
			peer.DERPMapURL = cl.DERPMapURL
		}
		if udp {
			return peer.DialUDPPort(ctx, port)
		}
		return peer.DialTCPPort(ctx, port)
	}
	if host == "server.tailcat" || host == "localhost" || host == "127.0.0.1" {
		if udp {
			return cl.DialUDPPort(ctx, port)
		}
		return cl.DialTCPPort(ctx, port)
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		ap := netip.AddrPortFrom(ip, port)
		if udp {
			return cl.DialUDP(ctx, ap)
		}
		return cl.DialTCP(ctx, ap)
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no addresses for %s", host)
	}
	ap := netip.AddrPortFrom(ips[0].Unmap(), port)
	if udp {
		return cl.DialUDP(ctx, ap)
	}
	return cl.DialTCP(ctx, ap)
}

func loadAuthorizedKeys(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("authorized keys are required")
	}
	if fi, err := os.Stat(raw); err == nil && !fi.IsDir() {
		body, err := os.ReadFile(raw)
		if err != nil {
			return nil, err
		}
		return []string{string(body)}, nil
	}
	return []string{raw}, nil
}

func loadSSHIdentity(path string) (gossh.Signer, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return gossh.ParsePrivateKey(body)
}

func serveEventPair(ch chan Event) (send func(Event), finish func(Event)) {
	var mu sync.Mutex
	closed := false
	send = func(ev Event) {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			return
		}
		select {
		case ch <- ev:
		default:
		}
	}
	finish = func(ev Event) {
		mu.Lock()
		defer mu.Unlock()
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
	return send, finish
}

func (r *Real) dropServe(sessionID string, run *serveRun) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if current, ok := r.serves[sessionID]; ok && current == run {
		delete(r.serves, sessionID)
	}
}
