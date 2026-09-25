#!/usr/bin/env python3
"""Package a Wails build for a GitHub Release.

Windows jobs publish two files from one ``wails build -nsis``:

* NSIS setup, renamed so the public filename includes ``installer``:
  ``tailcat-box-windows-amd64-installer-v0.4.0.exe``
* Bare portable exe, a copy of the runnable ``tailcat-box.exe``:
  ``tailcat-box-windows-amd64-v0.4.0.exe``

The portable asset is that single file, not a zip. Current Wails output is
the exe alone (the old portable zip contained only ``tailcat-box.exe``), so
sidecar ``.dll`` files are not copied into ``dist-upload``. A future build
that leaves a DLL beside the exe still publishes only this bare exe.

macOS jobs build a compressed disk image that contains the ``.app`` and an
Applications symlink (drag-to-Applications):

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
PORTABLE_EXE_NAME = "tailcat-box.exe"


def normalize_arch(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value in {"arm64", "aarch64", "arm"}:
        return "arm64"
    if value in {"x86_64", "amd64", "x64", "x86"}:
        return "amd64"
    return value or "unknown"


def _require_arch(arch: str) -> str:
    arch = normalize_arch(arch)
    if arch not in {"arm64", "amd64"}:
        raise SystemExit(f"unsupported arch: {arch}")
    return arch


def artifact_name(os_slug: str, arch: str, version: str) -> str:
    """Public installer name. Windows keeps the word installer in the filename."""
    arch = _require_arch(arch)
    if os_slug == "windows":
        return f"tailcat-box-windows-{arch}-installer-{version}.exe"
    if os_slug == "macos":
        return f"tailcat-box-macos-{arch}-{version}.dmg"
    raise SystemExit(f"unsupported os slug: {os_slug}")


def portable_exe_name(os_slug: str, arch: str, version: str) -> str:
    """Public Windows portable name. A bare runnable exe, not a zip."""
    arch = _require_arch(arch)
    if os_slug != "windows":
        raise SystemExit(f"portable exe is windows-only: {os_slug}")
    return f"tailcat-box-windows-{arch}-{version}.exe"


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


def is_nsis_installer(name: str) -> bool:
    return name.lower().endswith("-installer.exe")


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


def find_windows_portable_exe(bin_dir: Path) -> Path:
    """The double-clickable app, not the NSIS setup sitting next to it."""
    if not bin_dir.is_dir():
        raise SystemExit(f"missing build output directory: {bin_dir}")
    exes = sorted(
        p
        for p in bin_dir.iterdir()
        if p.is_file() and p.suffix.lower() == ".exe" and not is_nsis_installer(p.name)
    )
    preferred = [p for p in exes if p.name.lower() == PORTABLE_EXE_NAME]
    chosen = preferred or exes
    if len(chosen) == 1:
        return chosen[0]
    if not exes:
        raise SystemExit(
            f"no portable .exe in {bin_dir}. "
            "`wails build -nsis` leaves tailcat-box.exe next to the NSIS setup."
        )
    names = ", ".join(p.name for p in exes)
    raise SystemExit(f"expected one portable exe in {bin_dir}, found: {names}")


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


def package_windows_portable(bin_dir: Path, dest: Path) -> None:
    """Copy the runnable exe to the public portable name. No zip."""
    app = find_windows_portable_exe(bin_dir)
    if dest.exists():
        dest.unlink()
    shutil.copy2(app, dest)


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
    if args.os_slug == "windows":
        # Resolve both inputs before writing, so a missing file does not leave
        # a half-published dist-upload directory.
        find_windows_installer(bin_dir, arch)
        find_windows_portable_exe(bin_dir)
        installer = out_dir / artifact_name(args.os_slug, arch, args.version)
        portable = out_dir / portable_exe_name(args.os_slug, arch, args.version)
        package_windows_installer(bin_dir, installer, arch)
        package_windows_portable(bin_dir, portable)
        print(installer)
        print(portable)
    else:
        dest = out_dir / artifact_name(args.os_slug, arch, args.version)
        package_macos_dmg(find_macos_app(bin_dir), dest, args.volume_name)
        print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
