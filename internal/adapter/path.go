package adapter

import "strings"

const (
	// PathChecking means the session path to the peer is not known yet.
	PathChecking = "checking"
	// PathDirect means a direct endpoint is available for the peer.
	PathDirect = "direct"
	// PathDERP means the known session path is a DERP or other relay.
	PathDERP = "derp"
)

// PeerPath is the current session path to a peer.
// It is not a claim about which path carried any particular byte.
type PeerPath struct {
	Kind   string
	Detail string
}

// ClassifySessionPath reads a peer status snapshot.
// A direct endpoint wins over a relay. A relay with no direct endpoint is DERP.
// Neither means the path is still being checked.
func ClassifySessionPath(curAddr, relay, peerRelay string) PeerPath {
	if cur := strings.TrimSpace(curAddr); cur != "" {
		return PeerPath{Kind: PathDirect, Detail: cur}
	}
	if region := strings.TrimSpace(relay); region != "" {
		return PeerPath{Kind: PathDERP, Detail: region}
	}
	if via := strings.TrimSpace(peerRelay); via != "" {
		return PeerPath{Kind: PathDERP, Detail: via}
	}
	return PeerPath{Kind: PathChecking}
}

// ClassifyDisco reports how one disco pong arrived.
// A non-empty endpoint is direct. Any other successful pong is DERP.
func ClassifyDisco(endpoint, derpCode, derpID string) PeerPath {
	if ep := strings.TrimSpace(endpoint); ep != "" {
		return PeerPath{Kind: PathDirect, Detail: ep}
	}
	detail := strings.TrimSpace(derpCode)
	if detail == "" {
		detail = strings.TrimSpace(derpID)
	}
	return PeerPath{Kind: PathDERP, Detail: detail}
}

// MergePeerPath prefers a direct observation, then DERP, then checking.
// It does not wait for direct: a DERP result is reported as soon as it is the best known path.
func MergePeerPath(a, b PeerPath) PeerPath {
	if a.Kind == PathDirect {
		return a
	}
	if b.Kind == PathDirect {
		return b
	}
	if a.Kind == PathDERP {
		return a
	}
	if b.Kind == PathDERP {
		return b
	}
	if a.Kind == PathChecking {
		return a
	}
	return PeerPath{Kind: PathChecking}
}
