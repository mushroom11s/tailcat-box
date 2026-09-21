package adapter

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/pkg/sftp"
	"github.com/tailscale/tailcat"
	gossh "golang.org/x/crypto/ssh"
)

// FilesPort is the TCP port used by Tailcat SFTP / SSH file service.
const FilesPort uint16 = 22

func (r *Real) StartRecv(ctx context.Context, sessionID string, inboxDir string, acceptDirs bool) (<-chan Event, error) {
	if err := requireExistingDir(inboxDir, "inbox directory"); err != nil {
		return nil, err
	}
	mode := tailcat.FileServeWO
	if acceptDirs {
		mode = tailcat.FileServeWOPlus
	}
	return r.startFileServer(ctx, sessionID, inboxDir, mode)
}

func (r *Real) StartFilesServe(ctx context.Context, sessionID string, rootDir string, opts FilesServeOpts) (<-chan Event, error) {
	if err := requireExistingDir(rootDir, "directory"); err != nil {
		return nil, err
	}
	return r.startFileServer(ctx, sessionID, rootDir, toTailcatFileMode(opts.mode()))
}

func (r *Real) startFileServer(ctx context.Context, sessionID, rootDir string, mode tailcat.FileServeMode) (<-chan Event, error) {
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

	go r.runFileServer(ctx, sessionID, rootDir, mode, run, ch)
	return ch, nil
}

func (r *Real) runFileServer(ctx context.Context, sessionID, rootDir string, mode tailcat.FileServeMode, run *serveRun, ch chan Event) {
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

	abs, err := filepath.Abs(rootDir)
	if err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}

	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	handler := srv.SSHConnHandler(tailcat.SSHOptions{
		Files: &tailcat.FileService{Dir: abs, Mode: mode},
	})
	srv.OnTCP = func(port uint16) func(net.Conn) {
		if port != FilesPort {
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

func (r *Real) StartCopy(ctx context.Context, sessionID string, peerAddr string, localPaths []string, remotePath string) (<-chan Event, error) {
	if strings.TrimSpace(peerAddr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	if len(localPaths) == 0 {
		return nil, fmt.Errorf("at least one local path is required")
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

		sf, cleanup, err := dialSFTP(ctx, peerAddr)
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		defer cleanup()

		jobs, err := copyJobs(localPaths, remotePath)
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		total := len(jobs)
		for i, job := range jobs {
			if err := ctx.Err(); err != nil {
				ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
				return
			}
			if err := sftpPut(sf, job.local, job.remote); err != nil {
				ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
				return
			}
			ch <- Event{
				SessionID: sessionID,
				Kind:      EventData,
				Data:      fmt.Sprintf("copied %d/%d %s", i+1, total, job.remote),
			}
		}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (r *Real) ListRemote(ctx context.Context, peerAddr string, remotePath string) ([]FileEntry, error) {
	if strings.TrimSpace(peerAddr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	if remotePath == "" {
		remotePath = "."
	}
	sf, cleanup, err := dialSFTP(ctx, peerAddr)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	fi, err := sf.Stat(remotePath)
	if err != nil {
		return nil, err
	}
	if !fi.IsDir() {
		return []FileEntry{fileEntry(fi, path.Base(remotePath))}, nil
	}
	fis, err := sf.ReadDir(remotePath)
	if err != nil {
		return nil, err
	}
	out := make([]FileEntry, 0, len(fis))
	for _, info := range fis {
		out = append(out, fileEntry(info, info.Name()))
	}
	slices.SortFunc(out, func(a, b FileEntry) int {
		return strings.Compare(a.Name, b.Name)
	})
	return out, nil
}

func fileEntry(fi os.FileInfo, name string) FileEntry {
	return FileEntry{
		Name:    name,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		Mode:    fi.Mode().String(),
		ModTime: fi.ModTime().UTC(),
	}
}

func toTailcatFileMode(m FileServeMode) tailcat.FileServeMode {
	switch m {
	case FileServeRW:
		return tailcat.FileServeRW
	case FileServeWO:
		return tailcat.FileServeWO
	case FileServeWOPlus:
		return tailcat.FileServeWOPlus
	default:
		return tailcat.FileServeRO
	}
}

func requireExistingDir(dir, label string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("%s is required", label)
	}
	fi, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("%s is not a directory", label)
	}
	return nil
}

func dialSFTP(ctx context.Context, addr string) (*sftp.Client, func(), error) {
	cl := tailcat.NewClient(tailcat.Addr(addr))
	cl.Logf = func(string, ...any) {}
	conn, err := cl.DialTCPPort(ctx, FilesPort)
	if err != nil {
		_ = cl.Close()
		return nil, nil, fmt.Errorf("dialing server: %w", err)
	}
	sshConn, chans, reqs, err := gossh.NewClientConn(conn, "tailcat", &gossh.ClientConfig{
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		_ = conn.Close()
		_ = cl.Close()
		return nil, nil, fmt.Errorf("SSH handshake: %w", err)
	}
	sc := gossh.NewClient(sshConn, chans, reqs)
	sf, err := sftp.NewClient(sc)
	if err != nil {
		_ = sc.Close()
		_ = cl.Close()
		return nil, nil, fmt.Errorf("opening SFTP session: %w", err)
	}
	cleanup := func() {
		_ = sf.Close()
		_ = sc.Close()
		_ = cl.Close()
	}
	return sf, cleanup, nil
}

type copyJob struct {
	local  string
	remote string
}

func copyJobs(localPaths []string, remotePath string) ([]copyJob, error) {
	remotePath = strings.TrimSpace(remotePath)
	if remotePath == "" {
		remotePath = "."
	}
	var jobs []copyJob
	for _, local := range localPaths {
		local = strings.TrimSpace(local)
		if local == "" {
			continue
		}
		info, err := os.Stat(local)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			jobs = append(jobs, copyJob{local: local, remote: destPath(remotePath, filepath.Base(local), len(localPaths) == 1)})
			continue
		}
		err = filepath.WalkDir(local, func(p string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(local, p)
			if err != nil {
				return err
			}
			base := destDir(remotePath, filepath.Base(local), len(localPaths) == 1)
			remote := path.Join(base, filepath.ToSlash(rel))
			jobs = append(jobs, copyJob{local: p, remote: remote})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	if len(jobs) == 0 {
		return nil, fmt.Errorf("at least one local path is required")
	}
	return jobs, nil
}

func destDir(remotePath, base string, single bool) string {
	if remotePath == "." || remotePath == "" {
		if single {
			return base
		}
		return base
	}
	if strings.HasSuffix(remotePath, "/") {
		return path.Join(strings.TrimSuffix(remotePath, "/"), base)
	}
	return path.Join(remotePath, base)
}

func destPath(remotePath, base string, single bool) string {
	if remotePath == "." || remotePath == "" {
		return base
	}
	if strings.HasSuffix(remotePath, "/") {
		return path.Join(strings.TrimSuffix(remotePath, "/"), base)
	}
	if single {
		return remotePath
	}
	return path.Join(remotePath, base)
}

func sftpPut(sf *sftp.Client, local, remote string) error {
	in, err := os.Open(local)
	if err != nil {
		return err
	}
	defer in.Close()

	dir := path.Dir(remote)
	if dir != "." && dir != "/" && dir != "" {
		if err := sf.MkdirAll(dir); err != nil {
			return err
		}
	}
	out, err := sf.Create(remote)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
