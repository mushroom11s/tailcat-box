package main

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
	"github.com/mushroom11s/tailcat-box/internal/sshdesk"
	"github.com/mushroom11s/tailcat-box/internal/sshterm"
)

// SSHPeer is a saved device on the SSH allowlist.
type SSHPeer struct {
	Name    string
	Address string
}

// SSHDeskStatus is the Allow SSH card: off by default, address when serving,
// saved devices, and chat-room peers included in the allowlist.
type SSHDeskStatus struct {
	Enabled   bool
	AllowAny  bool
	Address   string
	SessionID string
	Peers     []SSHPeer
	RoomPeers []string
	Status    string
	Err       string
}

func (a *App) restoreSSH() {
	if a == nil || a.ssh == nil {
		return
	}
	st, err := a.ssh.Load()
	if err != nil || !st.Enabled {
		return
	}
	_, _ = a.startSSH(st)
}

// GetSSHDesk returns the persisted Allow SSH state.
func (a *App) GetSSHDesk() (SSHDeskStatus, error) {
	return a.sshStatus()
}

// SetSSHEnabled turns the built-in Tailcat SSH shell on or off and persists the choice.
func (a *App) SetSSHEnabled(enabled bool) (SSHDeskStatus, error) {
	st, err := a.loadSSH()
	if err != nil {
		return SSHDeskStatus{}, err
	}
	st.Enabled = enabled
	if err := a.ssh.Save(st); err != nil {
		return SSHDeskStatus{}, err
	}
	if !enabled {
		a.stopSSH()
		return a.sshStatus()
	}
	if _, err := a.startSSH(st); err != nil {
		return SSHDeskStatus{}, err
	}
	return a.waitSSHStatus()
}

// SetSSHAllowAny switches between the peer allowlist and anyone who has the address.
// Turning allow-any on requires confirm.
func (a *App) SetSSHAllowAny(allowAny bool, confirm bool) (SSHDeskStatus, error) {
	if allowAny && !confirm {
		return SSHDeskStatus{}, fmt.Errorf("allow any SSH requires explicit confirmation: anyone with the address gets a shell")
	}
	st, err := a.loadSSH()
	if err != nil {
		return SSHDeskStatus{}, err
	}
	st.AllowAny = allowAny
	if err := a.ssh.Save(st); err != nil {
		return SSHDeskStatus{}, err
	}
	if !st.Enabled {
		return a.sshStatus()
	}
	if _, err := a.startSSH(st); err != nil {
		return SSHDeskStatus{}, err
	}
	return a.waitSSHStatus()
}

// SaveSSHPeer adds or renames a device. The address must carry a Tailcat node key.
func (a *App) SaveSSHPeer(name, address string) (SSHDeskStatus, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return SSHDeskStatus{}, fmt.Errorf("address is required")
	}
	if _, err := a.svcAdapter.NodeKeyFromAddr(address); err != nil {
		return SSHDeskStatus{}, err
	}
	st, err := a.loadSSH()
	if err != nil {
		return SSHDeskStatus{}, err
	}
	name = strings.TrimSpace(name)
	replaced := false
	for i := range st.Peers {
		if st.Peers[i].Address == address {
			st.Peers[i].Name = name
			replaced = true
		}
	}
	if !replaced {
		st.Peers = append(st.Peers, sshdesk.Peer{Name: name, Address: address})
	}
	if err := a.ssh.Save(st); err != nil {
		return SSHDeskStatus{}, err
	}
	if st.Enabled && !st.AllowAny {
		if _, err := a.startSSH(st); err != nil {
			return SSHDeskStatus{}, err
		}
		return a.waitSSHStatus()
	}
	return a.sshStatus()
}

// RemoveSSHPeer drops a saved device from the allowlist.
func (a *App) RemoveSSHPeer(address string) (SSHDeskStatus, error) {
	address = strings.TrimSpace(address)
	st, err := a.loadSSH()
	if err != nil {
		return SSHDeskStatus{}, err
	}
	next := make([]sshdesk.Peer, 0, len(st.Peers))
	for _, p := range st.Peers {
		if p.Address == address {
			continue
		}
		next = append(next, p)
	}
	st.Peers = next
	if err := a.ssh.Save(st); err != nil {
		return SSHDeskStatus{}, err
	}
	if st.Enabled && !st.AllowAny {
		if _, err := a.startSSH(st); err != nil {
			return SSHDeskStatus{}, err
		}
		return a.waitSSHStatus()
	}
	return a.sshStatus()
}

// OpenSSHShell dials a peer with SSH "none" auth and opens an interactive shell.
// systemTerminal also attaches the system console. The peer is saved so this
// device's allowlist recognizes them on the next connection the other way.
func (a *App) OpenSSHShell(address string, systemTerminal bool) (session.Session, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return session.Session{}, fmt.Errorf("address is required")
	}
	if _, err := a.svcAdapter.NodeKeyFromAddr(address); err != nil {
		return session.Session{}, err
	}
	st, err := a.loadSSH()
	if err != nil {
		return session.Session{}, err
	}
	known := false
	for _, p := range st.Peers {
		if p.Address == address {
			known = true
			break
		}
	}
	if !known {
		if _, err := a.SaveSSHPeer("", address); err != nil {
			return session.Session{}, err
		}
		st, err = a.loadSSH()
		if err != nil {
			return session.Session{}, err
		}
	}
	if strings.TrimSpace(st.IdentityJSON) == "" {
		raw, err := a.svcAdapter.GeneratePrivateKeyJSON()
		if err != nil {
			return session.Session{}, err
		}
		st.IdentityJSON = raw
		if err := a.ssh.Save(st); err != nil {
			return session.Session{}, err
		}
	}
	pub, err := a.svcAdapter.PublicNodeKey(st.IdentityJSON)
	if err != nil {
		return session.Session{}, err
	}
	sess, err := a.svc.StartSSHClient(address, adapter.SSHClientOpts{
		Interactive:   true,
		NoClientAuth:  true,
		ClientKeyJSON: st.IdentityJSON,
		ClientNodeKey: pub,
	})
	if err != nil {
		return session.Session{}, err
	}
	if systemTerminal {
		if err := a.bridgeSSHTerminal(sess.ID); err != nil {
			_ = a.svc.Stop(sess.ID)
			return session.Session{}, err
		}
	}
	return sess, nil
}

// WriteSSHShell sends keystrokes to an in-app interactive shell.
func (a *App) WriteSSHShell(sessionID, data string) error {
	return a.svc.WriteSSH(sessionID, data)
}

func (a *App) bridgeSSHTerminal(sessionID string) error {
	out, cancel, err := a.svcAdapter.SubscribeSSH(sessionID)
	if err != nil {
		return err
	}
	bridge, err := sshterm.Listen()
	if err != nil {
		cancel()
		return err
	}
	pipe := &sshPipe{
		write:  func(p []byte) error { return a.svc.WriteSSH(sessionID, string(p)) },
		read:   out,
		cancel: cancel,
	}
	go func() {
		_ = bridge.Serve(context.Background(), pipe)
	}()
	if err := sshterm.Launch(bridge.Addr, bridge.Token); err != nil {
		_ = bridge.Close()
		cancel()
		return err
	}
	return nil
}

type sshPipe struct {
	write  func([]byte) error
	read   <-chan []byte
	buf    []byte
	cancel func()
}

func (p *sshPipe) Read(b []byte) (int, error) {
	if len(p.buf) == 0 {
		chunk, ok := <-p.read
		if !ok {
			return 0, io.EOF
		}
		p.buf = chunk
	}
	n := copy(b, p.buf)
	p.buf = p.buf[n:]
	return n, nil
}

func (p *sshPipe) Write(b []byte) (int, error) {
	if err := p.write(b); err != nil {
		return 0, err
	}
	return len(b), nil
}

func (p *sshPipe) Close() error {
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}

func (a *App) loadSSH() (sshdesk.State, error) {
	if a == nil || a.ssh == nil {
		return sshdesk.State{}, fmt.Errorf("ssh settings are unavailable")
	}
	return a.ssh.Load()
}

func (a *App) stopSSH() {
	a.sshMu.Lock()
	id := a.sshSession
	a.sshSession = ""
	a.sshMu.Unlock()
	if id != "" && a.svc != nil {
		_ = a.svc.Stop(id)
	}
}

func (a *App) startSSH(st sshdesk.State) (session.Session, error) {
	a.stopSSH()
	if strings.TrimSpace(st.IdentityJSON) == "" {
		raw, err := a.svcAdapter.GeneratePrivateKeyJSON()
		if err != nil {
			return session.Session{}, err
		}
		st.IdentityJSON = raw
		if err := a.ssh.Save(st); err != nil {
			return session.Session{}, err
		}
	}
	keys, err := a.allowKeys(st)
	if err != nil {
		return session.Session{}, err
	}
	sess, err := a.svc.StartSSHDesk(adapter.SSHServeOpts{
		AllowAny:        st.AllowAny,
		AllowedNodeKeys: keys,
		IdentityJSON:    st.IdentityJSON,
		PinnedAddr:      st.Address,
	})
	if err != nil {
		return session.Session{}, err
	}
	a.sshMu.Lock()
	a.sshSession = sess.ID
	a.sshMu.Unlock()
	return sess, nil
}

func (a *App) allowKeys(st sshdesk.State) ([]string, error) {
	var saved []string
	for _, p := range st.Peers {
		key, err := a.svcAdapter.NodeKeyFromAddr(p.Address)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", p.Address, err)
		}
		saved = append(saved, key)
	}
	var rooms []string
	if a.rooms != nil {
		for _, addr := range a.rooms.PeerAddresses() {
			key, err := a.svcAdapter.NodeKeyFromAddr(addr)
			if err != nil {
				continue
			}
			rooms = append(rooms, key)
		}
	}
	return sshdesk.AllowKeys(saved, rooms), nil
}

func (a *App) waitSSHStatus() (SSHDeskStatus, error) {
	deadline := time.After(3 * time.Second)
	for {
		st, err := a.sshStatus()
		if err != nil {
			return st, err
		}
		if st.Address != "" || st.Status == string(session.StatusError) || st.Status == string(session.StatusRunning) {
			if st.Address != "" {
				a.rememberAddress(st.Address)
			}
			return a.sshStatus()
		}
		select {
		case <-deadline:
			return a.sshStatus()
		case <-time.After(15 * time.Millisecond):
		}
	}
}

func (a *App) rememberAddress(addr string) {
	st, err := a.loadSSH()
	if err != nil || strings.TrimSpace(addr) == "" || st.Address == addr {
		return
	}
	st.Address = addr
	_ = a.ssh.Save(st)
}

func (a *App) sshStatus() (SSHDeskStatus, error) {
	st, err := a.loadSSH()
	if err != nil {
		return SSHDeskStatus{}, err
	}
	out := SSHDeskStatus{
		Enabled:   st.Enabled,
		AllowAny:  st.AllowAny,
		Address:   st.Address,
		Peers:     make([]SSHPeer, 0, len(st.Peers)),
		RoomPeers: []string{},
	}
	for _, p := range st.Peers {
		out.Peers = append(out.Peers, SSHPeer{Name: p.Name, Address: p.Address})
	}
	if a.rooms != nil {
		out.RoomPeers = sshdesk.RoomOnly(st.Peers, a.rooms.PeerAddresses())
		if out.RoomPeers == nil {
			out.RoomPeers = []string{}
		}
	}
	a.sshMu.Lock()
	id := a.sshSession
	a.sshMu.Unlock()
	out.SessionID = id
	if id != "" && a.svc != nil {
		for _, item := range a.svc.List() {
			if item.ID != id {
				continue
			}
			out.Status = string(item.Status)
			out.Err = item.Err
			if item.Address != "" {
				out.Address = item.Address
			}
		}
	}
	return out, nil
}
