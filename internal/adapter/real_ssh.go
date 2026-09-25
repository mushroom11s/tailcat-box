package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	osuser "os/user"
	"strings"

	"github.com/tailscale/tailcat"
	gossh "golang.org/x/crypto/ssh"
	"tailscale.com/types/key"
)

func sshUser(name string) string {
	name = strings.TrimSpace(name)
	if name != "" {
		return name
	}
	if u, err := osuser.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	return "tailcat"
}

func (r *Real) runSSHInteractive(ctx context.Context, sessionID, serverAddr string, sess *gossh.Session, fan *sshFan, ch chan Event) {
	stdin, err := sess.StdinPipe()
	if err != nil {
		ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
		return
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
		return
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
		return
	}
	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 14400,
		gossh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", 32, 100, modes); err != nil {
		ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
		return
	}
	if err := sess.Shell(); err != nil {
		ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
		return
	}
	r.mu.Lock()
	r.sshIn[sessionID] = stdin
	r.mu.Unlock()
	ch <- Event{SessionID: sessionID, Kind: EventReady, Address: serverAddr}

	out := make(chan string, 32)
	go readSSHPipe(stdout, out)
	go readSSHPipe(stderr, out)
	waited := make(chan struct{})
	go func() {
		_ = sess.Wait()
		close(waited)
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-waited:
			for {
				select {
				case chunk := <-out:
					publishSSH(sessionID, chunk, fan, ch)
				default:
					ch <- Event{SessionID: sessionID, Kind: EventClosed}
					return
				}
			}
		case chunk := <-out:
			publishSSH(sessionID, chunk, fan, ch)
		}
	}
}

func readSSHPipe(r io.Reader, out chan<- string) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			out <- string(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func publishSSH(sessionID, chunk string, fan *sshFan, ch chan Event) {
	if chunk == "" {
		return
	}
	fan.publish([]byte(chunk))
	ch <- Event{SessionID: sessionID, Kind: EventData, Data: chunk}
}

func (r *Real) WriteSSH(sessionID string, data string) error {
	r.mu.Lock()
	stdin := r.sshIn[sessionID]
	r.mu.Unlock()
	if stdin == nil {
		return fmt.Errorf("ssh session is not interactive")
	}
	_, err := io.WriteString(stdin, data)
	return err
}

func (r *Real) SubscribeSSH(sessionID string) (<-chan []byte, func(), error) {
	r.mu.Lock()
	fan := r.sshFan[sessionID]
	r.mu.Unlock()
	if fan == nil {
		return nil, nil, fmt.Errorf("ssh session is not interactive")
	}
	ch, cancel := fan.subscribe()
	return ch, cancel, nil
}

func (r *Real) NodeKeyFromAddr(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	if strings.HasPrefix(raw, "nodekey:") {
		var k key.NodePublic
		if err := k.UnmarshalText([]byte(raw)); err != nil {
			return "", fmt.Errorf("invalid node key: %w", err)
		}
		if k.IsZero() {
			return "", fmt.Errorf("invalid node key")
		}
		return k.String(), nil
	}
	ci, err := tailcat.ParseAddr(tailcat.Addr(raw))
	if err != nil {
		return "", err
	}
	if ci.ServerPublic.IsZero() {
		return "", fmt.Errorf("address has no node key")
	}
	return ci.ServerPublic.String(), nil
}

func (r *Real) PublicNodeKey(identityJSON string) (string, error) {
	pk, err := unmarshalTailcatKey(identityJSON)
	if err != nil {
		return "", err
	}
	return pk.Private.Public().String(), nil
}

func unmarshalTailcatKey(raw string) (tailcat.PrivateKey, error) {
	var pk tailcat.PrivateKey
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &pk); err != nil {
		return pk, fmt.Errorf("ssh identity: %w", err)
	}
	if pk.Private.IsZero() {
		return pk, fmt.Errorf("ssh identity is missing a node key")
	}
	return pk, nil
}

func parseNodeKeys(raw []string) ([]key.NodePublic, error) {
	var out []key.NodePublic
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		var k key.NodePublic
		if err := k.UnmarshalText([]byte(item)); err != nil {
			return nil, fmt.Errorf("invalid node key %q", item)
		}
		if k.IsZero() {
			return nil, fmt.Errorf("invalid node key %q", item)
		}
		out = append(out, k)
	}
	return out, nil
}

func applySSHIdentity(srv *tailcat.Server, opts SSHServeOpts) error {
	if strings.TrimSpace(opts.IdentityJSON) == "" {
		return nil
	}
	pk, err := unmarshalTailcatKey(opts.IdentityJSON)
	if err != nil {
		return err
	}
	srv.Key = pk.Private
	if !pk.Public.PresharedKey.IsZero() {
		srv.PresharedKey = pk.Public.PresharedKey
	}
	pinned := strings.TrimSpace(opts.PinnedAddr)
	if pinned == "" {
		return nil
	}
	ci, err := tailcat.ParseAddr(tailcat.Addr(pinned))
	if err != nil || ci.ServerPublic.String() != pk.Private.Public().String() {
		return nil
	}
	if len(ci.Region) > 0 && ci.Region[0] != nil {
		srv.Region = ci.Region[0]
	}
	return nil
}

func applySSHAllowlist(srv *tailcat.Server, opts SSHServeOpts) error {
	if !opts.RestrictClients || opts.AllowAny {
		return nil
	}
	keys, err := parseNodeKeys(opts.AllowedNodeKeys)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		// A non-empty list with a zero key makes the allow map non-nil,
		// which denies every real client. An empty list would allow everyone.
		srv.AllowedClients = []key.NodePublic{{}}
		return nil
	}
	srv.AllowedClients = keys
	return nil
}
