package adapter

import (
	"net/url"
	"strings"
)

const (
	// PathChecking means the session path to the peer is not known yet.
	PathChecking = "checking"
	// PathDirect means a direct endpoint is available for the peer.
	PathDirect = "direct"
	// PathDERP means the known session path is a DERP or other relay.
	PathDERP = "derp"
	// RelayPublic is Tailcat's default public DERP map: the official relay.
	RelayPublic = "public"
	// RelayCustom is a user-configured DERP map.
	RelayCustom = "custom"
	// PublicDERPMapURL is tailcat's default public map. An empty setting means this map.
	PublicDERPMapURL = "https://tailcat.dev/derpmap.json"
)

// PeerPath is the current session path to a peer.
// It is not a claim about which path carried any particular byte.
// RelaySource and RelayName describe a relay when Kind is derp.
type PeerPath struct {
	Kind        string
	Detail      string
	RelaySource string
	RelayName   string
}

// RegionLabel is one DERP region used to turn a code or id into a display name.
type RegionLabel struct {
	ID   string
	Code string
	Name string
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
// Between two relays, a region code replaces an opaque id. Two region codes stay with the first.
func MergePeerPath(a, b PeerPath) PeerPath {
	if a.Kind == PathDirect {
		return a
	}
	if b.Kind == PathDirect {
		return b
	}
	if a.Kind == PathDERP && b.Kind == PathDERP {
		if relayDetailRank(a.Detail) < relayDetailRank(b.Detail) {
			return b
		}
		return a
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

// AttributeRelay says whether a relay is Tailcat's official map or a user map,
// and the readable region or host to show. An empty name means no region was known.
func AttributeRelay(mapURL, detail, regionName string) (source, name string) {
	if defaultDERPMap(mapURL) {
		source = RelayPublic
	} else {
		source = RelayCustom
	}
	if n := cleanRelayLabel(regionName); n != "" {
		return source, n
	}
	// A self-hosted map is named by its host until the map itself gives a region name.
	// A short code on that map is not treated as a Tailscale city.
	if source == RelayCustom {
		if host := derpMapHost(mapURL); host != "" {
			return source, host
		}
	}
	d := strings.TrimSpace(detail)
	if looksLikeRegionCode(d) {
		return source, strings.ToLower(d)
	}
	if n := cleanRelayLabel(d); n != "" && !strings.ContainsAny(d, ".:/") {
		return source, n
	}
	return source, ""
}

// RegionDisplayName returns the map's display name for a region code or id.
func RegionDisplayName(regions []RegionLabel, detail string) string {
	want := strings.TrimSpace(detail)
	if want == "" {
		return ""
	}
	for _, reg := range regions {
		if reg.Code != "" && strings.EqualFold(reg.Code, want) {
			return cleanRelayLabel(reg.Name)
		}
	}
	for _, reg := range regions {
		if reg.ID != "" && reg.ID == want {
			return cleanRelayLabel(reg.Name)
		}
	}
	return ""
}

// AnnotateRelay fills relay ownership on a DERP path and clears it otherwise.
func AnnotateRelay(mapURL string, path PeerPath, regions []RegionLabel) PeerPath {
	if path.Kind != PathDERP {
		path.RelaySource = ""
		path.RelayName = ""
		return path
	}
	source, name := AttributeRelay(mapURL, path.Detail, RegionDisplayName(regions, path.Detail))
	path.RelaySource = source
	path.RelayName = name
	return path
}

func defaultDERPMap(raw string) bool {
	s := strings.TrimRight(strings.TrimSpace(raw), "/")
	if s == "" {
		return true
	}
	return strings.EqualFold(s, strings.TrimRight(PublicDERPMapURL, "/"))
}

func looksLikeRegionCode(s string) bool {
	if len(s) < 2 || len(s) > 4 {
		return false
	}
	for _, r := range s {
		if r < 'A' || (r > 'Z' && r < 'a') || r > 'z' {
			return false
		}
	}
	return true
}

func cleanRelayLabel(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" || len(s) > 80 || opaqueRelayDetail(s) {
		return ""
	}
	return s
}

func opaqueRelayDetail(s string) bool {
	if s == "" {
		return true
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func derpMapHost(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func relayDetailRank(detail string) int {
	d := strings.TrimSpace(detail)
	if looksLikeRegionCode(d) {
		return 2
	}
	if cleanRelayLabel(d) != "" && !strings.ContainsAny(d, ".:/") {
		return 1
	}
	if d != "" {
		return 0
	}
	return -1
}
