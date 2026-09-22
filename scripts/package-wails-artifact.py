#!/usr/bin/env python3
"""Zip the Wails build/bin output for GitHub Release upload."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


def normalize_arch(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value in {"arm64", "aarch64"}:
        return "arm64"
    if value in {"x86_64", "amd64", "x64"}:
        return "amd64"
    return value or "unknown"


def detect_arch() -> str:
    if os.environ.get("RUNNER_OS", "").lower() == "windows" or os.name == "nt":
        env_arch = os.environ.get("PROCESSOR_ARCHITECTURE", "")
        mapped = normalize_arch(env_arch)
        if mapped != "unknown":
            return mapped
    return normalize_arch(platform.machine())


def collect_sources(bin_dir: Path, os_slug: str) -> list[Path]:
    if not bin_dir.is_dir():
        raise SystemExit(f"missing build output directory: {bin_dir}")

    if os_slug == "macos":
        apps = sorted(p for p in bin_dir.iterdir() if p.suffix == ".app" and p.is_dir())
        if apps:
            return [apps[0]]
        raise SystemExit(f"no .app bundle found in {bin_dir}")

    if os_slug == "windows":
        exes = sorted(p for p in bin_dir.iterdir() if p.suffix.lower() == ".exe" and p.is_file())
        if exes:
            return [exes[0]]
        raise SystemExit(f"no .exe found in {bin_dir}")

    raise SystemExit(f"unsupported os slug: {os_slug}")


def add_path(zf: zipfile.ZipFile, source: Path, arc_root: str | None = None) -> None:
    if source.is_file():
        zf.write(source, arcname=source.name if arc_root is None else f"{arc_root}/{source.name}")
        return
    for path in sorted(source.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(source.parent)
        zf.write(path, arcname=str(rel).replace("\\", "/"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--os-slug", required=True, choices=("macos", "windows"))
    parser.add_argument("--bin-dir", default="build/bin")
    parser.add_argument("--out-dir", default="dist-upload")
    args = parser.parse_args()

    bin_dir = Path(args.bin_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sources = collect_sources(bin_dir, args.os_slug)
    arch = detect_arch()
    name = f"tailcat-box-{args.os_slug}-{arch}-{args.version}.zip"
    dest = out_dir / name

    if args.os_slug == "macos" and shutil.which("ditto"):
        if len(sources) != 1:
            raise SystemExit("macos packaging expects a single .app bundle")
        subprocess.run(
            ["ditto", "-c", "-k", "--keepParent", str(sources[0]), str(dest)],
            check=True,
        )
    else:
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for source in sources:
                add_path(zf, source)

    print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
