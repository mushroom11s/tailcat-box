#!/usr/bin/env bash
# Cloud Agent environment bootstrap for the Tailcat Desktop Client.
#
# Installs the toolchain needed to build the planned Wails (Go + React/TypeScript)
# desktop app on the Linux Cloud Agent VM, then prepares any project dependencies
# that already exist in the checkout. Safe to run repeatedly (idempotent).
set -euo pipefail

log() { printf '\n\033[0;36m==> %s\033[0m\n' "$1"; }

# --- System dependencies for Wails on Linux -------------------------------
# Wails builds a native GTK/WebKit shell. Ubuntu 24.04 ships WebKit2GTK 4.1,
# which Wails targets via the `webkit2_41` build tag.
log "Installing system dependencies (GTK / WebKit / build tools)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -o Acquire::Retries=3
sudo apt-get install -y --no-install-recommends \
  build-essential \
  pkg-config \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev

# --- Wails CLI ------------------------------------------------------------
# Pinned for reproducibility. `go install` honours GOTOOLCHAIN=auto, so the
# required Go toolchain is fetched automatically if the base Go is older.
WAILS_VERSION="v2.16.0"
GOBIN_DIR="$(go env GOPATH)/bin"
export PATH="$PATH:$GOBIN_DIR"

if ! command -v wails >/dev/null 2>&1 || [ "$(wails version 2>/dev/null | head -1)" != "$WAILS_VERSION" ]; then
  log "Installing Wails CLI ${WAILS_VERSION}"
  go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"
else
  log "Wails CLI ${WAILS_VERSION} already present"
fi

# Ensure the Go bin dir is on PATH for future interactive shells.
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$rc"
  if ! grep -qF "$GOBIN_DIR" "$rc"; then
    printf 'export PATH="$PATH:%s"\n' "$GOBIN_DIR" >> "$rc"
  fi
done

# --- Project dependencies (present once the app is scaffolded) ------------
# The repository currently holds only docs + implementation plans. These guards
# make the script forward-compatible: once Plan 1 adds a Go module and the
# frontend, dependencies are fetched automatically on the next environment build.
if [ -f go.mod ]; then
  log "Downloading Go module dependencies"
  go mod download
fi

if [ -f frontend/package.json ]; then
  log "Installing frontend dependencies"
  if [ -f frontend/package-lock.json ]; then
    (cd frontend && npm ci)
  else
    (cd frontend && npm install)
  fi
fi

log "Environment ready"
printf 'Go:    %s\n' "$(go version)"
printf 'Node:  %s\n' "$(node --version)"
printf 'Wails: %s\n' "$(wails version 2>/dev/null | head -1)"
