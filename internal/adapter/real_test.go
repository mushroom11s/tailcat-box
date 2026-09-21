package adapter_test

import (
	"strings"
	"testing"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func TestRealImplementsAdapter(t *testing.T) {
	var _ adapter.TailcatAdapter = adapter.NewReal()
}

func TestTailcatVersionPinned(t *testing.T) {
	v := adapter.NewReal().Version()
	if v == "" || v == "unknown" {
		t.Fatalf("version=%q", v)
	}
	if !strings.HasPrefix(v, "v") && !strings.Contains(v, "-") {
		t.Fatalf("unexpected version %q", v)
	}
}
