package adapter_test

import (
	"context"
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

func TestRealParseAddr(t *testing.T) {
	r := adapter.NewReal()
	if _, err := r.ParseAddr(""); err == nil {
		t.Fatal("expected error")
	}
	if _, err := r.ParseAddr("not-a-tailcat-addr"); err == nil {
		t.Fatal("expected error")
	}
}

func TestRealPortServeRequiresMappings(t *testing.T) {
	r := adapter.NewReal()
	if _, err := r.StartPortServe(context.Background(), "s", nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestRealFilesValidation(t *testing.T) {
	r := adapter.NewReal()
	ctx := context.Background()
	if _, err := r.StartFilesServe(ctx, "s", "", adapter.FilesServeOpts{}); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("files serve err=%v", err)
	}
	if _, err := r.StartRecv(ctx, "s", "", false); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("recv err=%v", err)
	}
	if _, err := r.StartCopy(ctx, "s", "", nil, "."); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("copy err=%v", err)
	}
	if _, err := r.ListRemote(ctx, "", "."); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("ls err=%v", err)
	}
}
