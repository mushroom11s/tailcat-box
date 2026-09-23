# Tailcat Box (猫砂盆) — In-app update, Phase 1

**Date:** 2026-09-23  
**Status:** Phase 1 implemented in this change. Phase 2 is design only.  
**Product name:** Tailcat Box (English UI) / 猫砂盆 (简体中文 UI)  
**Source of updates:** GitHub Releases for [`mushroom11s/tailcat-box`](https://github.com/mushroom11s/tailcat-box)

## 中文摘要

第一阶段采用方案 B：启动后大约每 24 小时向 GitHub Releases 查一次最新的正式版，设置里也可以手动「现在检查」。发现更新时，不弹窗、不刷托盘，只在左上角像素猫标旁边放一枚像素风 **NEW!**。点 NEW! 会打开设置并滚到更新卡片。用户可以下载与本机系统匹配的 zip 到系统「下载」文件夹，再在访达 / 资源管理器里显示它，并看到几句安装说明。本阶段不替换正在运行的程序，也不自动重启。签名之后的一键安装并重启留到第二阶段，这里只写清楚，不写代码。

## 1. Goals / non-goals

### Goals

- Detect a newer stable GitHub Release than the version compiled into this binary.
- Show a pixel-style **NEW!** badge beside the sidebar logo when that check succeeds and a package exists for this OS and CPU.
- Let Settings check now, show the latest tag, a short release-notes excerpt, download the zip, reveal it, and explain how to install it.
- Keep the existing ~24 hour startup check, but make it a real GitHub check instead of a timestamp-only stub.
- Persist the last check and the last successful release metadata so the badge can appear after restart without another request, until the next check says otherwise.
- Fail closed: network errors, rate limits, parse failures, and a missing package never turn on NEW!.

### Locked decisions

| Topic | Decision |
| --- | --- |
| Phase 1 | Approach B: check → download zip to Downloads → reveal in Finder/Explorer → short install steps. |
| Phase 2 | Signed install-and-restart. Documented below. No code in this change. |
| Release channel | Latest GitHub Release that is not a draft and not a prerelease. |
| Version compare | Semver of the release tag with one leading `v`/`V` stripped, compared with `internal/appinfo.Version` / `ClientVersion()`. |
| Notification | NEW! badge on `.brand` / `.brand-mark` only. No modal. No tray item. No OS notification. |
| Check timing | Startup check at most once per 24 hours (`updateCheckInterval`). Settings **Check now** always runs a real check. |
| Copy | Natural product Chinese and English. The old “cannot update online” hint is replaced. |

### Non-goals

- Code signing, notarization, Sparkle, Squirrel, or any helper that replaces the running `.app` / `.exe`.
- Auto-restart, silent install, or quitting the app as part of download.
- A Linux release asset. The app may still compile on Linux; the check then says there is no package for this system and does not show NEW!.
- Changing the Release workflow or asset names.
- A GitHub token. Public release metadata is enough. Rate-limit responses are errors, not updates.
- A “dismiss NEW!” control. The badge stays until a successful check shows this build is not older, or a later check fails (the badge hides on error).

## 2. Phase 1 behavior

### Check

`GET https://api.github.com/repos/mushroom11s/tailcat-box/releases/latest`

That endpoint already returns the latest non-draft, non-prerelease release. The client still refuses the payload when `draft` or `prerelease` is true.

Request headers:

- `User-Agent`: `TailcatBox/<version> (+https://github.com/mushroom11s/tailcat-box)`
- `Accept`: `application/vnd.github+json`
- `X-GitHub-Api-Version`: `2022-11-28`

The tag (`tag_name`, for example `v0.1.0`) is parsed as semver. Build metadata (`+…`) is ignored. `0.1.0-dev` is a prerelease, so it is older than `0.1.0`. Dev builds therefore see the current stable release as an update. Release builds stamp `appinfo.Version` from the tag with the leading `v` removed (`0.1.0`), via the existing `-ldflags` in the Release workflow.

An update is available only when all of these are true:

1. The latest tag parses and is strictly newer than `ClientVersion()`.
2. An asset matches this `GOOS` / `GOARCH` (see below).
3. The check itself did not fail.

Startup calls this from `maybeRecordDailyUpdateCheck` when `LastUpdateCheck` is empty or older than 24 hours. A finished attempt, including a definitive error, records the timestamp so a down network does not hit GitHub on every launch. **Check now** ignores the interval.

When the result changes, the backend emits `tailcat:update` with the status struct. Download progress emits `tailcat:update-progress` (`Received`, `Total`, `Percent`). The frontend listens so NEW! can appear without restart. On launch, the UI also reads the persisted status, because an event fired before the page subscribed would otherwise be missed.

### NEW! badge

Rendered only when `UpdateAvailable` is true and the status is not `error` or `unsupported`. It sits in the `.brand` row, beside `.brand-mark`, not in the nav list. The face is the letters **NEW!** in both locales (a sticker, not a sentence). The accessible name is localized and still contains `NEW!`.

Style: chunky mono type, hard yellow fill, stepped black pixel outline, small offset shadow. Same colors in light and dark so it stays a sticker on the pixel cat.

Clicking it switches to Settings (same destination as the tray’s Settings item, without going through the tray) and scrolls `#settings-update` into view with an `update-focus` outline. Opening Settings from the nav or the tray does not highlight the card.

### Settings

The existing About / client-info card is `#settings-update`. It shows:

- Uptime, this app version, Tailcat module version (unchanged).
- Latest version and tag when known.
- Last checked time.
- A one-line status (up to date, update ready, downloaded, no package, or a translated error).
- Release-notes excerpt (at most 500 runes of the release body).
- **Check now**.
- **Download** when an update is available. A second click after a finished download is **Download again**.
- A progress bar fed by `tailcat:update-progress` while the download call is in flight. The Wails method returns when the file is written.
- **Reveal in Finder** / **Show in Explorer** / **Show in folder** once the zip is on disk.
- A link to the GitHub release page (`https://github.com/mushroom11s/tailcat-box/…` only).
- Short install steps after a successful download, chosen from `Platform` (`darwin`, `windows`, otherwise).

The standing hint says the app can check, download, and guide, and that it cannot yet replace itself or restart.

Install steps, in product language:

- **macOS:** quit Tailcat Box, open the zip in Downloads, drag `Tailcat Box.app` into Applications over the old app, then open it. Unsigned builds may need Control-click → Open the first time.
- **Windows:** quit Tailcat Box, open the zip in Downloads, replace `tailcat-box.exe`. SmartScreen may warn because the build is unsigned.
- **Other:** there is no published package. If a file was downloaded anyway, quit and replace the binary by hand.

### Download and reveal

`DownloadUpdate` ignores any path or URL from the frontend. It downloads the asset URL stored by the last successful check, and only after `validateAssetURL` accepts it.

Production rules:

- The first URL is `https://github.com/mushroom11s/tailcat-box/releases/download/…`.
- Redirects may go to `github.com`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com`, or `github-releases.githubusercontent.com`, still over HTTPS.
- The file name is the asset name, restricted to `[A-Za-z0-9._-]` and a `.zip` suffix. `..` and path separators are rejected.
- Bytes are written to `<Downloads>/<name>.partial`, then renamed over `<Downloads>/<name>`. The cap is 1 GiB.
- Downloads is `~/Downloads` (or `TAILCAT_DOWNLOADS_DIR` in tests). The directory is created if needed.

`RevealDownloadedUpdate` checks the stored path still exists, then:

- macOS: `open -R <file>`
- Windows: `explorer /select,<file>`
- anything else: open the parent folder

Phase 1 stops there. The running process is not touched.

## 3. Asset matching

Confirmed against [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) and [`docs/releases/v0.1.0.md`](../../releases/v0.1.0.md). The zip name is `tailcat-box-{os-slug}-{arch}-{tag}.zip`, and `{tag}` is the git tag **including** the leading `v` (`version` in the workflow, not `app_version`).

| GOOS | GOARCH | Asset |
| --- | --- | --- |
| `darwin` | `arm64` | `tailcat-box-macos-arm64-v0.1.0.zip` |
| `darwin` | `amd64` | `tailcat-box-macos-amd64-v0.1.0.zip` |
| `windows` | `amd64` | `tailcat-box-windows-amd64-v0.1.0.zip` |
| `windows` | `arm64` | `tailcat-box-windows-arm64-v0.1.0.zip` |
| `linux` or any other arch | | no match |

The `v0.1.0` segment is the example tag. Matching is case-insensitive and tries, in order:

1. `tailcat-box-{slug}-{arch}-{tag}.zip` (tag as published, usually `vX.Y.Z`).
2. `tailcat-box-{slug}-{arch}-v{bare}.zip`.
3. `tailcat-box-{slug}-{arch}-{bare}.zip` where `bare` is the tag without one leading `v`.
4. If exactly one zip has the prefix `tailcat-box-{slug}-{arch}-`, use it. If several do, keep the one whose name contains the tag; if that is still ambiguous, fail with `no_asset`.

`darwin` maps to slug `macos`. `windows` stays `windows`. Only `amd64` and `arm64` match. A newer release with no row for this machine is status `unsupported`, not an update.

## 4. Persistence

`settings.json` keeps the existing fields and adds an `Update` object. `LastUpdateCheck` remains the 24 hour clock.

```json
{
  "LaunchAtLogin": false,
  "LastUpdateCheck": "2026-09-23T11:00:00Z",
  "Update": {
    "LatestTag": "v0.2.0",
    "LatestVersion": "0.2.0",
    "ReleaseURL": "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
    "Notes": "excerpt",
    "AssetName": "tailcat-box-macos-arm64-v0.2.0.zip",
    "DownloadURL": "https://github.com/mushroom11s/tailcat-box/releases/download/v0.2.0/tailcat-box-macos-arm64-v0.2.0.zip",
    "DownloadedPath": "/Users/me/Downloads/tailcat-box-macos-arm64-v0.2.0.zip",
    "Status": "downloaded",
    "Error": ""
  }
}
```

| Status | Meaning | NEW!? |
| --- | --- | --- |
| `""` | Never checked, or only the legacy timestamp exists. | No |
| `upToDate` | Latest tag is not newer. | No |
| `available` | Newer tag and a matching asset. | Yes |
| `downloaded` | Same, and `DownloadedPath` still names a file. | Yes |
| `unsupported` | Newer or current release has no package for this OS/CPU. | No |
| `error` | Network, rate limit, or parse failure. | No |

There is no dismissed flag. On `error`, previous tag / notes / URL are kept for Settings, but `UpdateAvailable` is forced false. A later successful check replaces them. If the asset name changes, the stored download path is cleared (the old zip is left on disk). If a recheck finds the same asset and the file is still there, status stays `downloaded`. If the file was removed, the UI falls back to **Download**. If the running version is no longer older, the badge turns off even before the stored status is rewritten.

`TAILCAT_UPDATE_URL` overrides the API URL for tests. It is not a user setting.

## 5. Error handling

| Case | `Error` code | Status | NEW!? |
| --- | --- | --- | --- |
| DNS, timeout, connection reset, HTTP 5xx | `network` | `error` | No |
| HTTP 403/429 with rate-limit body or `X-RateLimit-Remaining: 0` | `rate_limit` | `error` | No |
| Non-JSON, missing tag, invalid semver, draft/prerelease payload, HTTP 404 | `parse` | `error` | No |
| This GOOS/GOARCH is not a release target | `unsupported` | `unsupported` | No |
| Release is newer but no zip matches | `no_asset` | `unsupported` | No |
| Download failed, blocked URL, or disk error | `download` | stays `available` | Yes, so the user can retry |

The frontend translates the codes. It does not show a raw Go error for these cases. A download failure does not pretend the check failed; the update is still available.

Wails methods:

| Method | Role |
| --- | --- |
| `GetUpdateStatus` | Persisted status plus a fresh semver comparison. No network. |
| `CheckForUpdate` | Real GitHub check. Used by **Check now** and the daily startup check. |
| `DownloadUpdate` | Writes the stored asset into Downloads. Emits progress. |
| `RevealDownloadedUpdate` | Reveals the zip or opens its folder. |
| `RecordUpdateCheck` | Compatibility wrapper that calls `CheckForUpdate` and returns `ClientInfo`. |

`GetClientInfo.LastUpdateCheck` still reports the same timestamp.

## 6. Phase 2 stub (not implemented)

After the macOS build is signed and notarized, and the Windows build is Authenticode-signed, a later change can install and restart:

- A small helper, started after the user agrees, waits until this process exits, replaces `Tailcat Box.app` or `tailcat-box.exe` with the unzipped build, then relaunches.
- Sparkle (macOS) or a Squirrel-style Windows update are options once signatures exist. Neither belongs in Phase 1.
- Unsigned Gatekeeper and SmartScreen prompts are why Phase 1 only downloads and explains.
- The Phase 1 zip, reveal, and install steps stay as the fallback if install-and-restart is declined or fails.

No swap, no relaunch, and no extra process are added here.

## 7. Testing notes

Backend, `go test ./...`:

- Table tests for semver precedence, including `v` prefix, prerelease (`0.1.0-dev` < `0.1.0`), build metadata, and invalid strings.
- Table tests for asset selection: the four release names, Linux, missing asset, ambiguous prefix, case folding.
- `httptest` GitHub JSON: newer, up to date, prerelease, rate limit, bad JSON, HTTP 500, no matching asset.
- Download writes the expected bytes, reports progress, and rejects a non-GitHub asset URL unless the test config opts into permissive URLs.
- App-level: a successful check persists; a following HTTP 500 clears `UpdateAvailable` but keeps the last tag; the 24 hour gate does not call GitHub twice; a download leaves a zip in the test downloads directory.

Frontend, `npm test` in `frontend/`:

- NEW! is absent until `UpdateAvailable` is true, including when the status is an error.
- NEW! is present when an update is available. Activating it shows Settings and `#settings-update.update-focus`.
- **Check now** calls the check binding.

Manual pass on a real build:

1. Run a build whose `appinfo.Version` is older than the latest stable tag (a default `0.1.0-dev` build qualifies while `v0.1.0` or newer is the latest stable release).
2. Launch and wait for the startup check, or open Settings → **Check now**.
3. Confirm NEW! sits beside the logo in light and dark, and that no dialog or tray item appears.
4. Click NEW!. Settings scrolls to the update card and shows the latest tag plus a notes excerpt.
5. Download. The zip lands in Downloads. Reveal selects it in Finder or Explorer. The install steps match the OS.
6. Pull the network cable, or block `api.github.com`, and check again. NEW! disappears and Settings shows a translated error.
