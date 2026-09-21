package adapter

import (
	"context"
	"fmt"
)

func (r *Real) StartRecv(ctx context.Context, sessionID string, inboxDir string, acceptDirs bool) (<-chan Event, error) {
	_ = ctx
	_ = sessionID
	_ = inboxDir
	_ = acceptDirs
	return nil, fmt.Errorf("files recv not wired")
}

func (r *Real) StartCopy(ctx context.Context, sessionID string, peerAddr string, localPaths []string, remotePath string) (<-chan Event, error) {
	_ = ctx
	_ = sessionID
	_ = peerAddr
	_ = localPaths
	_ = remotePath
	return nil, fmt.Errorf("files copy not wired")
}

func (r *Real) StartFilesServe(ctx context.Context, sessionID string, rootDir string, opts FilesServeOpts) (<-chan Event, error) {
	_ = ctx
	_ = sessionID
	_ = rootDir
	_ = opts
	return nil, fmt.Errorf("files serve not wired")
}

func (r *Real) ListRemote(ctx context.Context, peerAddr string, path string) ([]FileEntry, error) {
	_ = ctx
	_ = peerAddr
	_ = path
	return nil, fmt.Errorf("files ls not wired")
}
