# Release notes template

Add a file named after the git tag **before** you push that tag:

```text
docs/releases/vX.Y.Z.md
```

The [Release](../../.github/workflows/release.yml) workflow attaches that file as the GitHub Release body. If the file is missing, this README is copied into a short fallback.

## Checklist for a new tag

1. Update or add `docs/releases/vX.Y.Z.md` (bilingual is fine).
2. Merge that commit to `main`.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Wait for the Release workflow (macOS + Windows). Do not force-push tags.

## Suggested headings

- What shipped (Plans / features)
- Fake vs real adapter
- Platforms and artifacts
- Known gaps (signing, Settings, architectures)
- Install notes for unsigned builds
