package update

import "testing"

func TestParseAndCompareSemver(t *testing.T) {
	t.Parallel()
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.2.3", "1.2.3", 0},
		{"V1.2.3", "1.2.3", 0},
		{"1.2.3+build.1", "v1.2.3", 0},
		{"1.0.0", "1.0.0-alpha", 1},
		{"1.0.0-alpha", "1.0.0-alpha.1", -1},
		{"1.0.0-alpha.1", "1.0.0-alpha.beta", -1},
		{"1.0.0-alpha.beta", "1.0.0-beta", -1},
		{"1.0.0-beta", "1.0.0-beta.2", -1},
		{"1.0.0-beta.2", "1.0.0-beta.11", -1},
		{"1.0.0-beta.11", "1.0.0-rc.1", -1},
		{"1.0.0-rc.1", "1.0.0", -1},
		{"1.2.3", "1.2.2", 1},
		{"1.2.0", "1.3.0", -1},
		{"2.0.0", "1.9.9", 1},
		{"0.1.0", "0.1.0-dev", 1},
		{"0.1.0-dev", "v0.1.0", -1},
		{"0.1.0-dev", "0.1.0-dev", 0},
		{"0.2.0-dev", "0.1.0", 1},
	}
	for _, tc := range cases {
		got, err := Compare(tc.a, tc.b)
		if err != nil {
			t.Fatalf("Compare(%q, %q): %v", tc.a, tc.b, err)
		}
		if got != tc.want {
			t.Fatalf("Compare(%q, %q)=%d want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestIsNewer(t *testing.T) {
	t.Parallel()
	newer, err := IsNewer("v0.1.0", "0.1.0-dev")
	if err != nil || !newer {
		t.Fatalf("dev should see stable as newer: %v %v", newer, err)
	}
	newer, err = IsNewer("0.1.0", "0.1.0")
	if err != nil || newer {
		t.Fatalf("equal versions are not newer: %v %v", newer, err)
	}
	if _, err := IsNewer("nope", "1.0.0"); err == nil {
		t.Fatal("expected invalid latest to fail")
	}
}

func TestParseVersionRejects(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"", "1.2", "01.2.3", "1.02.3", "1.2.3-", "1.2.3-01", "not-a-version", "v", "1.2.3-beta!"} {
		if _, err := ParseVersion(raw); err == nil {
			t.Fatalf("ParseVersion(%q) succeeded", raw)
		}
	}
}
