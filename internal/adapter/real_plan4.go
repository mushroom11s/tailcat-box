package adapter

import (
	"context"
	"fmt"
)

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

func (r *Real) StartSSHServe(ctx context.Context, sessionID string, opts SSHServeOpts) (<-chan Event, error) {
	return nil, fmt.Errorf("ssh serve is not wired")
}

func (r *Real) StartSSHClient(ctx context.Context, sessionID string, serverAddr string, opts SSHClientOpts) (<-chan Event, error) {
	return nil, fmt.Errorf("ssh client is not wired")
}

func (r *Real) StartSOCKS(ctx context.Context, sessionID string, serverAddr string, listen string) (<-chan Event, error) {
	return nil, fmt.Errorf("socks is not wired")
}

func (r *Real) StartExitNode(ctx context.Context, sessionID string) (<-chan Event, error) {
	return nil, fmt.Errorf("exit-node is not wired")
}

func (r *Real) StartExec(ctx context.Context, sessionID string, argv []string) (<-chan Event, error) {
	return nil, fmt.Errorf("exec is not wired")
}
