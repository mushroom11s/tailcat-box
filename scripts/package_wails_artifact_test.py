#!/usr/bin/env python3
"""Tests for release installer naming and packaging. No hdiutil required."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def load_module():
    path = Path(__file__).with_name("package-wails-artifact.py")
    spec = importlib.util.spec_from_file_location("package_wails_artifact", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pkg = load_module()
SCRIPT = Path(__file__).with_name("package-wails-artifact.py")


class ArtifactNameTest(unittest.TestCase):
    def test_release_names(self) -> None:
        self.assertEqual(
            pkg.artifact_name("windows", "amd64", "v0.4.0"),
            "tailcat-box-windows-amd64-installer-v0.4.0.exe",
        )
        self.assertEqual(
            pkg.artifact_name("windows", "arm64", "v0.4.0"),
            "tailcat-box-windows-arm64-installer-v0.4.0.exe",
        )
        self.assertEqual(
            pkg.portable_exe_name("windows", "amd64", "v0.4.0"),
            "tailcat-box-windows-amd64-v0.4.0.exe",
        )
        self.assertEqual(
            pkg.portable_exe_name("windows", "arm64", "v0.4.0"),
            "tailcat-box-windows-arm64-v0.4.0.exe",
        )
        self.assertEqual(
            pkg.artifact_name("macos", "arm64", "v0.4.0"),
            "tailcat-box-macos-arm64-v0.4.0.dmg",
        )
        self.assertEqual(
            pkg.artifact_name("macos", "amd64", "v0.4.0"),
            "tailcat-box-macos-amd64-v0.4.0.dmg",
        )

    def test_arch_aliases_keep_version_prefix(self) -> None:
        self.assertEqual(
            pkg.artifact_name("macos", "x86_64", "v0.4.0"),
            "tailcat-box-macos-amd64-v0.4.0.dmg",
        )
        self.assertEqual(
            pkg.artifact_name("windows", "aarch64", "dev-abc1234"),
            "tailcat-box-windows-arm64-installer-dev-abc1234.exe",
        )
        self.assertEqual(
            pkg.portable_exe_name("windows", "x64", "dev-abc1234"),
            "tailcat-box-windows-amd64-dev-abc1234.exe",
        )


class WindowsPackageTest(unittest.TestCase):
    def test_ships_labeled_installer_and_bare_portable_exe(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bin_dir = root / "bin"
            out_dir = root / "out"
            bin_dir.mkdir()
            (bin_dir / "tailcat-box.exe").write_bytes(b"app-exe")
            (bin_dir / "WebView2Loader.dll").write_bytes(b"sidecar-dll")
            (bin_dir / "tailcat-box-amd64-installer.exe").write_bytes(b"setup-amd64")
            (bin_dir / "tailcat-box-arm64-installer.exe").write_bytes(b"setup-arm64")
            (bin_dir / "tailcat-box-amd64_arm64-installer.exe").write_bytes(b"combined")

            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--version",
                    "v0.4.0",
                    "--os-slug",
                    "windows",
                    "--arch",
                    "amd64",
                    "--bin-dir",
                    str(bin_dir),
                    "--out-dir",
                    str(out_dir),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            installer = out_dir / "tailcat-box-windows-amd64-installer-v0.4.0.exe"
            portable = out_dir / "tailcat-box-windows-amd64-v0.4.0.exe"
            self.assertEqual(installer.read_bytes(), b"setup-amd64")
            self.assertEqual(portable.read_bytes(), b"app-exe")
            self.assertEqual(
                sorted(p.name for p in out_dir.iterdir()),
                [installer.name, portable.name],
            )
            self.assertEqual(list(out_dir.glob("*.zip")), [])

    def test_arm64_installer_is_separate_from_the_portable_exe(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bin_dir = root / "bin"
            out_dir = root / "out"
            bin_dir.mkdir()
            (bin_dir / "tailcat-box.exe").write_bytes(b"app-exe")
            (bin_dir / "tailcat-box-amd64-installer.exe").write_bytes(b"setup-amd64")
            (bin_dir / "tailcat-box-arm64-installer.exe").write_bytes(b"setup-arm64")

            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--version",
                    "v0.4.0",
                    "--os-slug",
                    "windows",
                    "--arch",
                    "arm64",
                    "--bin-dir",
                    str(bin_dir),
                    "--out-dir",
                    str(out_dir),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            installer = out_dir / "tailcat-box-windows-arm64-installer-v0.4.0.exe"
            portable = out_dir / "tailcat-box-windows-arm64-v0.4.0.exe"
            self.assertEqual(installer.read_bytes(), b"setup-arm64")
            self.assertEqual(portable.read_bytes(), b"app-exe")
            self.assertEqual(list(out_dir.glob("*.zip")), [])

    def test_missing_portable_exe_fails(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "tailcat-box-amd64-installer.exe").write_bytes(b"setup-amd64")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--version",
                    "v0.4.0",
                    "--os-slug",
                    "windows",
                    "--arch",
                    "amd64",
                    "--bin-dir",
                    str(bin_dir),
                    "--out-dir",
                    str(root / "out"),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("portable", result.stderr + result.stdout)
            self.assertEqual(list((root / "out").glob("*")), [])

    def test_missing_installer_fails(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "tailcat-box.exe").write_bytes(b"app-exe")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--version",
                    "v0.4.0",
                    "--os-slug",
                    "windows",
                    "--arch",
                    "arm64",
                    "--bin-dir",
                    str(bin_dir),
                    "--out-dir",
                    str(root / "out"),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("NSIS", result.stderr + result.stdout)


class MacStageTest(unittest.TestCase):
    def test_layout_has_app_and_applications_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            app = root / "tailcat-box.app"
            contents = app / "Contents"
            contents.mkdir(parents=True)
            (contents / "Info.plist").write_text("plist", encoding="utf-8")
            staging = root / "stage"
            staging.mkdir()
            pkg.stage_macos_layout(app, staging)
            staged = staging / "tailcat-box.app" / "Contents" / "Info.plist"
            self.assertEqual(staged.read_text(encoding="utf-8"), "plist")
            link = staging / "Applications"
            self.assertTrue(link.is_symlink())
            self.assertEqual(os_readlink(link), "/Applications")


def os_readlink(path: Path) -> str:
    return str(path.readlink())


if __name__ == "__main__":
    unittest.main()
