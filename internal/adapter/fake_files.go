package adapter

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (f *Fake) StartRecv(ctx context.Context, sessionID string, inboxDir string, acceptDirs bool) (<-chan Event, error) {
	if strings.TrimSpace(inboxDir) == "" {
		return nil, fmt.Errorf("inbox directory is required")
	}
	ch := make(chan Event, 8)
	stop := f.track(sessionID)
	addr := "tc:fake-recv-" + sessionID
	f.mu.Lock()
	f.files[sessionID] = addr
	f.mu.Unlock()
	_ = acceptDirs

	go func() {
		defer close(ch)
		defer f.untrack(sessionID)

		select {
		case <-time.After(10 * time.Millisecond):
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		case <-stop:
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		}

		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: addr}
		select {
		case <-time.After(10 * time.Millisecond):
			f.mu.Lock()
			f.drops[sessionID]++
			n := f.drops[sessionID]
			f.mu.Unlock()
			ch <- Event{SessionID: sessionID, Kind: EventData, Data: fmt.Sprintf("received drop-%d.txt", n)}
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		case <-stop:
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (f *Fake) StartCopy(ctx context.Context, sessionID string, peerAddr string, localPaths []string, remotePath string) (<-chan Event, error) {
	ch := make(chan Event, 8)
	go func() {
		defer close(ch)
		_ = remotePath
		select {
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: ctx.Err().Error()}
			return
		default:
		}
		if !f.knownFileServe(peerAddr) {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "unknown fake files serve"}
			return
		}
		if len(localPaths) == 0 {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "at least one local path is required"}
			return
		}
		total := len(localPaths)
		for i, p := range localPaths {
			ch <- Event{
				SessionID: sessionID,
				Kind:      EventData,
				Data:      fmt.Sprintf("copied %d/%d %s", i+1, total, p),
			}
		}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (f *Fake) StartFilesServe(ctx context.Context, sessionID string, rootDir string, opts FilesServeOpts) (<-chan Event, error) {
	if strings.TrimSpace(rootDir) == "" {
		return nil, fmt.Errorf("directory is required")
	}
	ch := make(chan Event, 4)
	stop := f.track(sessionID)
	addr := "tc:fake-files-" + sessionID
	f.mu.Lock()
	f.files[sessionID] = addr
	f.mu.Unlock()
	_ = opts

	go func() {
		defer close(ch)
		defer f.untrack(sessionID)
		select {
		case <-time.After(10 * time.Millisecond):
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		case <-stop:
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		}
		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: addr}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (f *Fake) ListRemote(ctx context.Context, peerAddr string, path string) ([]FileEntry, error) {
	_ = ctx
	if !f.knownFileServe(peerAddr) {
		return nil, fmt.Errorf("unknown fake files serve")
	}
	if path == "" {
		path = "."
	}
	_ = path
	now := time.Unix(0, 0).UTC()
	return []FileEntry{
		{Name: "hello.txt", IsDir: false, Size: 12, Mode: "-rw-r--r--", ModTime: now},
		{Name: "photos", IsDir: true, Size: 0, Mode: "drwxr-xr-x", ModTime: now},
	}, nil
}

func (f *Fake) knownFileServe(addr string) bool {
	if !strings.HasPrefix(addr, "tc:fake-files-") && !strings.HasPrefix(addr, "tc:fake-recv-") {
		return false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, served := range f.files {
		if served == addr {
			return true
		}
	}
	return false
}
