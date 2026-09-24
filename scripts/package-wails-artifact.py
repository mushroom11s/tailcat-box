#!/usr/bin/env python3
"""Package a Wails build as a GitHub Release installer.

Windows jobs copy the NSIS setup produced by ``wails build -nsis``.
macOS jobs build a compressed disk image that contains the ``.app`` and an
Applications symlink (drag-to-Applications). The release asset is the
installer itself, not a zip of it.

Names follow the old zip basename, with the extension changed:

    tailcat-box-windows-amd64-v0.4.0.exe
    tailcat-box-windows-arm64-v0.4.0.exe
    tailcat-box-macos-arm64-v0.4.0.dmg
    tailcat-box-macos-amd64-v0.4.0.dmg

``version`` keeps the leading ``v`` from the git tag.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


VOLUME_NAME = "Tailcat Box"


def normalize_arch(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value in {"arm64", "aarch64", "arm"}:
        return "arm64"
    if value in {"x86_64", "amd64", "x64", "x86"}:
        return "amd64"
    return value or "unknown"


def artifact_name(os_slug: str, arch: str, version: str) -> str:
    arch = normalize_arch(arch)
    if arch not in {"arm64", "amd64"}:
        raise SystemExit(f"unsupported arch: {arch}")
    ext = {"windows": ".exe", "macos": ".dmg"}[os_slug]
    return f"tailcat-box-{os_slug}-{arch}-{version}{ext}"


def detect_arch() -> str:
    if os.environ.get("RUNNER_OS", "").lower() == "windows" or os.name == "nt":
        env_arch = os.environ.get("PROCESSOR_ARCHITECTURE", "")
        mapped = normalize_arch(env_arch)
        if mapped != "unknown":
            return mapped
    return normalize_arch(platform.machine())


def find_macos_app(bin_dir: Path) -> Path:
    if not bin_dir.is_dir():
        raise SystemExit(f"missing build output directory: {bin_dir}")
    apps = sorted(p for p in bin_dir.iterdir() if p.suffix == ".app" and p.is_dir())
    if len(apps) == 1:
        return apps[0]
    if not apps:
        raise SystemExit(f"no .app bundle found in {bin_dir}")
    raise SystemExit(f"expected one .app bundle in {bin_dir}, found {len(apps)}")


def is_arch_installer(name: str, arch: str) -> bool:
    lower = name.lower()
    suffix = f"-{arch}-installer.exe"
    # Reject a combined amd64_arm64 installer; each matrix cell ships one arch.
    return lower.endswith(suffix) and not lower.endswith(f"_{arch}-installer.exe")


def find_windows_installer(bin_dir: Path, arch: str) -> Path:
    if not bin_dir.is_dir():
        raise SystemExit(f"missing build output directory: {bin_dir}")
    arch = normalize_arch(arch)
    matches = sorted(
        p for p in bin_dir.iterdir() if p.is_file() and is_arch_installer(p.name, arch)
    )
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise SystemExit(
            f"no NSIS installer for {arch} in {bin_dir}. "
            "Install NSIS so makensis is on PATH, then run `wails build -nsis`."
        )
    names = ", ".join(p.name for p in matches)
    raise SystemExit(f"expected one {arch} NSIS installer in {bin_dir}, found: {names}")


def copy_bundle(src: Path, dest: Path) -> None:
    if shutil.which("ditto"):
        subprocess.run(["ditto", str(src), str(dest)], check=True)
        return
    shutil.copytree(src, dest, symlinks=True)


def stage_macos_layout(app: Path, staging: Path) -> None:
    """Place the app and an Applications symlink at the disk-image root."""
    copy_bundle(app, staging / app.name)
    applications = staging / "Applications"
    applications.symlink_to("/Applications")


def create_dmg(staging: Path, dest: Path, volume_name: str) -> None:
    if shutil.which("hdiutil") is None:
        raise SystemExit("hdiutil is required to build the macOS disk image")
    if dest.exists():
        dest.unlink()
    # Stock hdiutil. Finder AppleScript layout hangs on headless GitHub runners,
    # so the image root is just the .app plus the Applications symlink.
    subprocess.run(
        [
            "hdiutil",
            "create",
            "-volname",
            volume_name,
            "-srcfolder",
            str(staging),
            "-ov",
            "-format",
            "UDZO",
            str(dest),
        ],
        check=True,
    )


def package_macos_dmg(app: Path, dest: Path, volume_name: str = VOLUME_NAME) -> None:
    staging = Path(tempfile.mkdtemp(prefix="tailcat-dmg-"))
    try:
        stage_macos_layout(app, staging)
        create_dmg(staging, dest, volume_name)
    finally:
        shutil.rmtree(staging)


def package_windows_installer(bin_dir: Path, dest: Path, arch: str) -> None:
    installer = find_windows_installer(bin_dir, arch)
    if dest.exists():
        dest.unlink()
    shutil.copy2(installer, dest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--os-slug", required=True, choices=("macos", "windows"))
    parser.add_argument("--arch", default="", help="amd64 or arm64. Defaults to this machine.")
    parser.add_argument("--bin-dir", default="build/bin")
    parser.add_argument("--out-dir", default="dist-upload")
    parser.add_argument("--volume-name", default=VOLUME_NAME)
    args = parser.parse_args()

    bin_dir = Path(args.bin_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    arch = args.arch or detect_arch()
    dest = out_dir / artifact_name(args.os_slug, arch, args.version)
    if args.os_slug == "windows":
        package_windows_installer(bin_dir, dest, arch)
    else:
        package_macos_dmg(find_macos_app(bin_dir), dest, args.volume_name)

    print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
