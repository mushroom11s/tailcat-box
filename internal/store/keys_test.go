package store_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mushroom11s/tailcat-desktop-client/internal/store"
)

func TestCreateListDelete(t *testing.T) {
	dir := t.TempDir()
	s := store.New(dir)

	addr, err := s.Create("home", store.CreateOpts{Region: "nyc"})
	if err != nil {
		t.Fatal(err)
	}
	if addr == "" {
		t.Fatal("expected address")
	}

	keys, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 {
		t.Fatalf("len=%d", len(keys))
	}
	if keys[0].Name != "home" || keys[0].Address != addr || keys[0].Client {
		t.Fatalf("%+v", keys[0])
	}
	if _, err := os.Stat(filepath.Join(dir, "home.private.json")); err != nil {
		t.Fatal(err)
	}

	if err := s.Delete("home"); err != nil {
		t.Fatal(err)
	}
	keys, err = s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 0 {
		t.Fatalf("after delete %+v", keys)
	}
}

func TestCreateClientKey(t *testing.T) {
	s := store.New(t.TempDir())
	addr, err := s.Create("laptop", store.CreateOpts{Client: true})
	if err != nil {
		t.Fatal(err)
	}
	if addr == "" {
		t.Fatal("expected public identity")
	}
	keys, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || !keys[0].Client || keys[0].Name != "laptop" {
		t.Fatalf("%+v", keys)
	}
}

func TestListIncludesCLIKeyDir(t *testing.T) {
	appDir := t.TempDir()
	cliDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(cliDir, "default.private.json"), []byte(`{"Name":"default","Address":"tc:cli-default"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s := store.New(appDir)
	s.ExtraDir = cliDir
	if _, err := s.Create("appkey", store.CreateOpts{}); err != nil {
		t.Fatal(err)
	}
	keys, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, k := range keys {
		names[k.Name] = k.Source
	}
	if names["appkey"] != "app" {
		t.Fatalf("%+v", keys)
	}
	if names["default"] != "cli" {
		t.Fatalf("%+v", keys)
	}
}

func TestCreateRejectsBadName(t *testing.T) {
	s := store.New(t.TempDir())
	if _, err := s.Create("", store.CreateOpts{}); err == nil {
		t.Fatal("expected error")
	}
	if _, err := s.Create("../escape", store.CreateOpts{}); err == nil {
		t.Fatal("expected error")
	}
}
