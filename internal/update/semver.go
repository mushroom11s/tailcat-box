package update

import (
	"errors"
	"fmt"
	"strings"
)

// Version is a semver 2.0.0 core version plus prerelease identifiers.
// Build metadata is accepted by ParseVersion and ignored when comparing.
type Version struct {
	Major int
	Minor int
	Patch int
	Pre   []string
}

// String returns the version without a leading v and without build metadata.
func (v Version) String() string {
	s := fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
	if len(v.Pre) > 0 {
		s += "-" + strings.Join(v.Pre, ".")
	}
	return s
}

// ParseVersion parses a semver string. One leading v or V is stripped.
func ParseVersion(raw string) (Version, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return Version{}, errors.New("empty version")
	}
	if s[0] == 'v' || s[0] == 'V' {
		s = s[1:]
	}
	if i := strings.IndexByte(s, '+'); i >= 0 {
		if i == 0 {
			return Version{}, errors.New("missing version")
		}
		s = s[:i]
	}
	pre := ""
	if i := strings.IndexByte(s, '-'); i >= 0 {
		pre = s[i+1:]
		s = s[:i]
		if pre == "" {
			return Version{}, errors.New("empty prerelease")
		}
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return Version{}, errors.New("version must be major.minor.patch")
	}
	nums := [3]int{}
	for i, part := range parts {
		n, err := parseNumeric(part)
		if err != nil {
			return Version{}, err
		}
		nums[i] = n
	}
	var preParts []string
	if pre != "" {
		preParts = strings.Split(pre, ".")
		for _, part := range preParts {
			if !validPrerelease(part) {
				return Version{}, errors.New("invalid prerelease")
			}
		}
	}
	return Version{Major: nums[0], Minor: nums[1], Patch: nums[2], Pre: preParts}, nil
}

func parseNumeric(s string) (int, error) {
	if s == "" || (len(s) > 1 && s[0] == '0') {
		return 0, errors.New("invalid numeric identifier")
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, errors.New("invalid numeric identifier")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

func validPrerelease(s string) bool {
	if s == "" {
		return false
	}
	numeric := true
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '-':
			numeric = false
		default:
			return false
		}
	}
	if numeric && len(s) > 1 && s[0] == '0' {
		return false
	}
	return true
}

// Compare returns -1 when a < b, 0 when they are equal, and 1 when a > b.
func Compare(a, b string) (int, error) {
	va, err := ParseVersion(a)
	if err != nil {
		return 0, err
	}
	vb, err := ParseVersion(b)
	if err != nil {
		return 0, err
	}
	return compareVersion(va, vb), nil
}

// IsNewer reports whether latest is a strictly newer semver than current.
func IsNewer(latest, current string) (bool, error) {
	cmp, err := Compare(latest, current)
	if err != nil {
		return false, err
	}
	return cmp > 0, nil
}

func compareVersion(a, b Version) int {
	if c := cmpInt(a.Major, b.Major); c != 0 {
		return c
	}
	if c := cmpInt(a.Minor, b.Minor); c != 0 {
		return c
	}
	if c := cmpInt(a.Patch, b.Patch); c != 0 {
		return c
	}
	return comparePre(a.Pre, b.Pre)
}

func comparePre(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if c := compareIdent(a[i], b[i]); c != 0 {
			return c
		}
	}
	return cmpInt(len(a), len(b))
}

func compareIdent(a, b string) int {
	an, aOK := identNumber(a)
	bn, bOK := identNumber(b)
	if aOK && bOK {
		return cmpInt(an, bn)
	}
	if aOK && !bOK {
		return -1
	}
	if !aOK && bOK {
		return 1
	}
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func identNumber(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
	}
	return n, true
}

func cmpInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}
