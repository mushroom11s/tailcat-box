# Releases

Pushing a `v*` tag on [mushroom11s/tailcat-box](https://github.com/mushroom11s/tailcat-box) builds unsigned macOS and Windows zips and attaches them to a GitHub Release. Per-tag notes live in this directory. The public README only summarizes that. This file is the maintainer checklist.

The [Release workflow](../../.github/workflows/release.yml) uses standard GitHub-hosted runners. It does not use larger runners.

| Runner | Binary |
| --- | --- |
| `macos-latest` | Apple Silicon, `tailcat-box-macos-arm64-…` |
| `macos-15-intel` | Intel Mac, `tailcat-box-macos-amd64-…`. `macos-13` was retired in December 2025. |
| `windows-latest` | Windows amd64, `tailcat-box-windows-amd64-…` |
| `windows-11-arm` | Windows ARM64, `tailcat-box-windows-arm64-…` |

| Workflow | When | What |
| --- | --- | --- |
| [CI](../../.github/workflows/ci.yml) | Pull requests and pushes to `main` | `go test ./...` and `frontend` `npm ci` + `npm run build` on `ubuntu-latest` |
| [Release](../../.github/workflows/release.yml) | Push of a `v*` tag, or **Run workflow** | `wails build` for the four targets above, zip `build/bin`, and publish a GitHub Release when the tag is real |

Binaries are unsigned (no Apple notarization, no Authenticode), so Gatekeeper and SmartScreen warnings are expected.

## Cut a release

1. Add notes at `docs/releases/vX.Y.Z.md` (bilingual is fine) and merge that commit to `main`.
2. Tag the merged commit and push only that tag:

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

3. The workflow builds the zips and attaches them to the GitHub Release. The body is `docs/releases/<tag>.md` when that file exists. If it is missing, this README is copied into a short fallback. Do not force-push tags.

## Dry run

**Actions → Release → Run workflow** keeps **dry_run** checked by default. That builds and uploads workflow artifacts without creating a GitHub Release. Uncheck dry_run only when you mean to publish, and supply a `v*` tag. A pushed `v*` tag always publishes; dry_run applies to manual runs.

## Suggested headings

- What shipped
- Fake vs real adapter
- Platforms and artifacts
- Known gaps
- Install notes for unsigned builds
