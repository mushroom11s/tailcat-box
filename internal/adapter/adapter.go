package adapter

import (
	"context"
	"time"
)

type EventKind string

const (
	EventReady  EventKind = "ready" // Address set for serve
	EventData   EventKind = "data"  // payload bytes as string for Plan 1 text pipe
	EventError  EventKind = "error"
	EventClosed EventKind = "closed"
)

type Event struct {
	SessionID string
	Kind      EventKind
	Address   string // for EventReady
	Data      string // for EventData
	Err       string // for EventError
}

// PortMapping describes a TCP port mapping.
//
// Zero-value semantics match the Tailcat CLI:
//   - RemoteHost empty means localhost
//   - RemotePort zero means the same port as LocalPort
//   - LocalPort zero on forward/browse asks the OS for a free port
type PortMapping struct {
	LocalPort  uint16
	RemoteHost string
	RemotePort uint16
}

func (m PortMapping) destHost() string {
	if m.RemoteHost == "" {
		return "localhost"
	}
	return m.RemoteHost
}

func (m PortMapping) destPort() uint16 {
	if m.RemotePort != 0 {
		return m.RemotePort
	}
	return m.LocalPort
}

// FileServeMode matches Tailcat CLI --files suffixes: ro, rw, wo, wo+.
type FileServeMode string

const (
	FileServeRO     FileServeMode = "ro"
	FileServeRW     FileServeMode = "rw"
	FileServeWO     FileServeMode = "wo"
	FileServeWOPlus FileServeMode = "wo+"
)

type FilesServeOpts struct {
	Mode FileServeMode // empty means read-only
}

func (o FilesServeOpts) mode() FileServeMode {
	if o.Mode == "" {
		return FileServeRO
	}
	return o.Mode
}

// SSHServeOpts matches CLI `serve ssh` / `serve no-auth-ssh`.
type SSHServeOpts struct {
	NoAuth         bool
	AuthorizedKeys string // path or authorized_keys text; ignored when NoAuth
}

// SSHClientOpts matches CLI `tailcat ssh`.
type SSHClientOpts struct {
	User     string
	Command  string
	Identity string // optional private key path
}

// NetworkOpts is CLI `--region` / `--derpmap-url` for adapter starts.
type NetworkOpts struct {
	Region     string // ID, code, name substring, or empty/"auto"
	DERPMapURL string
}

type FileEntry struct {
	Name    string
	IsDir   bool
	Size    int64
	Mode    string
	ModTime time.Time
}

type TailcatAdapter interface {
	// StartPipeServe begins an ephemeral server; emits EventReady with Address, then EventData/Closed/Error.
	StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error)
	// DialPipe connects to addr and writes payload; emits EventData for any reply optional; then EventClosed.
	DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error)
	// StartPortServe advertises TCP ports / mappings and emits EventReady with the serve address.
	StartPortServe(ctx context.Context, sessionID string, mappings []PortMapping) (<-chan Event, error)
	// StartForward listens locally and forwards to serverAddr using mappings.
	StartForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping) (<-chan Event, error)
	// StartBrowse local-forwards remote port 80 then signals ready with a local URL in Event.Address or Event.Data.
	StartBrowse(ctx context.Context, sessionID string, serverAddr string) (<-chan Event, error)
	// StartPing emits EventData pong lines and EventClosed when done.
	StartPing(ctx context.Context, sessionID string, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error)
	// ParseAddr returns JSON describing a tailcat address (CLI `parse`).
	ParseAddr(raw string) (string, error)
	// ResolveAddr returns a self-contained equivalent of raw (CLI `resolve`).
	ResolveAddr(ctx context.Context, raw string) (string, error)
	// StartRecv serves a write-only drop-box inbox (CLI `recv`).
	StartRecv(ctx context.Context, sessionID string, inboxDir string, acceptDirs bool) (<-chan Event, error)
	// StartCopy copies localPaths to peerAddr:remotePath (CLI `cp` send).
	StartCopy(ctx context.Context, sessionID string, peerAddr string, localPaths []string, remotePath string) (<-chan Event, error)
	// StartFilesServe serves rootDir over SFTP (CLI `serve files`).
	StartFilesServe(ctx context.Context, sessionID string, rootDir string, opts FilesServeOpts) (<-chan Event, error)
	// ListRemote lists path on a files/recv/ssh peer (CLI `ls`).
	ListRemote(ctx context.Context, peerAddr string, path string) ([]FileEntry, error)
	// StartSSHServe starts an SSH server. NoAuth is CLI `no-auth-ssh`; otherwise AuthorizedKeys is required.
	StartSSHServe(ctx context.Context, sessionID string, opts SSHServeOpts) (<-chan Event, error)
	// StartSSHClient dials SSH on port 22 and runs command (empty command uses a short identity check).
	StartSSHClient(ctx context.Context, sessionID string, serverAddr string, opts SSHClientOpts) (<-chan Event, error)
	// StartSOCKS listens locally as a SOCKS5 proxy toward serverAddr.
	StartSOCKS(ctx context.Context, sessionID string, serverAddr string, listen string) (<-chan Event, error)
	// StartExitNode serves as an exit node (CLI `serve exit-node`).
	StartExitNode(ctx context.Context, sessionID string) (<-chan Event, error)
	// StartExec runs argv for each incoming connection (CLI `serve exec`).
	StartExec(ctx context.Context, sessionID string, argv []string) (<-chan Event, error)
	// SetNetworkOpts stores region / DERP map URL used by subsequent starts.
	SetNetworkOpts(opts NetworkOpts)
	NetworkOpts() NetworkOpts
	Stop(sessionID string) error
}
