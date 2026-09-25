package adapter_test

import (
	"context"
	"strings"
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
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

func TestRealPlan4Validation(t *testing.T) {
	r := adapter.NewReal()
	ctx := context.Background()
	if _, err := r.StartSSHServe(ctx, "s", adapter.SSHServeOpts{}); err == nil || !strings.Contains(err.Error(), "authorized keys") {
		t.Fatalf("ssh serve err=%v", err)
	}
	if _, err := r.StartSSHClient(ctx, "s", "", adapter.SSHClientOpts{}); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("ssh client err=%v", err)
	}
	if _, err := r.StartSOCKS(ctx, "s", "", ""); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("socks err=%v", err)
	}
	if _, err := r.StartExec(ctx, "s", nil); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("exec err=%v", err)
	}
	if _, err := r.StartSSHServe(ctx, "s", adapter.SSHServeOpts{NoAuth: true, RestrictClients: true, AllowedNodeKeys: []string{"not-a-key"}}); err == nil || !strings.Contains(err.Error(), "node key") {
		t.Fatalf("bad allowlist err=%v", err)
	}
	raw, err := r.GeneratePrivateKeyJSON()
	if err != nil {
		t.Fatal(err)
	}
	pub, err := r.PublicNodeKey(raw)
	if err != nil || !strings.HasPrefix(pub, "nodekey:") {
		t.Fatalf("pub=%q err=%v", pub, err)
	}
	got, err := r.NodeKeyFromAddr(pub)
	if err != nil || got != pub {
		t.Fatalf("nodekey roundtrip %q err=%v", got, err)
	}
	if _, err := r.NodeKeyFromAddr("tc:not-a-real-address"); err == nil {
		t.Fatal("expected parse error")
	}
	r.SetNetworkOpts(adapter.NetworkOpts{Region: "1", DERPMapURL: "https://example.test/derpmap.json"})
	opts := r.NetworkOpts()
	if opts.Region != "1" || opts.DERPMapURL == "" {
		t.Fatalf("%+v", opts)
	}
}
