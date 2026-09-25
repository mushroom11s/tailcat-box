# Releases

Pushing a `v*` tag on [mushroom11s/tailcat-box](https://github.com/mushroom11s/tailcat-box) builds unsigned macOS disk images, Windows NSIS setup programs, and a Windows portable zip, and attaches those files to a GitHub Release. Per-tag notes live in this directory. The public README only summarizes that. This file is the maintainer checklist.

The [Release workflow](../../.github/workflows/release.yml) uses standard GitHub-hosted runners. It does not use larger runners.

| Runner | Artifacts |
| --- | --- |
| `macos-latest` | Apple Silicon disk image, `tailcat-box-macos-arm64-<tag>.dmg` |
| `macos-15-intel` | Intel Mac disk image, `tailcat-box-macos-amd64-<tag>.dmg`. `macos-13` was retired in December 2025. |
| `windows-latest` | Windows amd64 NSIS setup `tailcat-box-windows-amd64-installer-<tag>.exe`, and portable zip `tailcat-box-windows-amd64-<tag>.zip` |
| `windows-11-arm` | Windows ARM64 NSIS setup `tailcat-box-windows-arm64-installer-<tag>.exe`, and portable zip `tailcat-box-windows-arm64-<tag>.zip` |

The Windows installer filename always includes `installer`. The portable zip uses the v0.3.0 name and contains the double-clickable `tailcat-box.exe` (plus any `.dll` Wails left beside it). It is not a bare `.exe`, so it does not collide with the setup program.

| Workflow | When | What |
| --- | --- | --- |
| [CI](../../.github/workflows/ci.yml) | Pull requests and pushes to `main` | `go test ./...`, `scripts/package_wails_artifact_test.py`, and `frontend` `npm ci` + `npm run build` on `ubuntu-latest` |
| [Release](../../.github/workflows/release.yml) | Push of a `v*` tag, or **Run workflow** | `wails build` for the four targets above, package a `.dmg`, a Windows NSIS `.exe` whose name includes `installer`, and a Windows portable `.zip`, and publish a GitHub Release when the tag is real |

Installers are unsigned (no Apple notarization, no Authenticode), so Gatekeeper and SmartScreen warnings are expected.

## Cut a release

1. Add notes at `docs/releases/vX.Y.Z.md` (bilingual is fine) and merge that commit to `main`.
2. Tag the merged commit and push only that tag:

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

3. The workflow builds the installers and the Windows portable zip, and attaches the `.dmg`, installer `.exe`, and `.zip` files to the GitHub Release. The body is `docs/releases/<tag>.md` when that file exists. If it is missing, this README is copied into a short fallback. Do not force-push tags.

The filename version is the git tag, including the leading `v` (`tailcat-box-macos-arm64-v0.4.0.dmg`). Each Windows matrix cell runs `wails build -nsis` after `choco install nsis`. That leaves a single-arch NSIS setup and the runnable `tailcat-box.exe`. Packaging copies the setup to `tailcat-box-windows-<arch>-installer-<tag>.exe` and zips the exe (and sidecar DLLs) as `tailcat-box-windows-<arch>-<tag>.zip`. Each macOS cell wraps `tailcat-box.app` plus an Applications symlink in a UDZO disk image with stock `hdiutil`. Installers are unsigned (no notarization, no Authenticode).

The in-app updater prefers the macOS `.dmg` and the Windows installer whose name contains `installer`. It still accepts the v1.0.0 / v1.1.0 setup names (`tailcat-box-windows-<arch>-<tag>.exe`, which did not say `installer`) and the older `.zip` names. A portable zip published next to the labeled installer is not selected.

## Dry run

**Actions → Release → Run workflow** keeps **dry_run** checked by default. That builds and uploads workflow artifacts without creating a GitHub Release. Uncheck dry_run only when you mean to publish, and supply a `v*` tag. A pushed `v*` tag always publishes; dry_run applies to manual runs.

## Check an installer locally

Windows, with NSIS installed so `makensis` is on PATH. `build/windows/installer/project.nsi` turns `info.productVersion` into a four-part file version, so that field has to be `N.N.N` (the release workflow writes it before `wails build -nsis`):

```bash
wails build -nsis
python scripts/package-wails-artifact.py --version v0.4.0 --os-slug windows --arch amd64
```

That writes both of these under `dist-upload/`:

- `tailcat-box-windows-amd64-installer-v0.4.0.exe` — NSIS setup
- `tailcat-box-windows-amd64-v0.4.0.zip` — unzip and run `tailcat-box.exe`

macOS, after `wails build` has written `build/bin/tailcat-box.app`:

```bash
wails build
python scripts/package-wails-artifact.py --version v0.4.0 --os-slug macos --arch arm64
```

Both commands write `dist-upload/`. A dry run of the Release workflow uploads those same files as Actions artifacts and does not create a GitHub Release.

## Suggested headings

- What shipped
- Fake vs real adapter
- Platforms and artifacts
- Known gaps
- Install notes for unsigned builds
