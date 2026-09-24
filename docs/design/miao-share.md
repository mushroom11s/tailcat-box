# 喵传 (Miao Share)

**Status:** v1 implemented.  
**Product:** Tailcat Box / 猫砂盆

## 中文摘要

侧栏在「聊天」上面加一项 **喵传**。把文件拖进右侧虚线区域（或点一下选择），猫砂盆把文件复制到自己管理的临时目录里，磁盘上的文件名会换成随机名，界面仍显示原来的名字。然后给出一个二维码和可复制的口令。对方也用猫砂盆，扫码或粘贴口令后，通过 Tailcat 点对点把这一包文件下载下来。没有中转服务器。分享的人必须一直在线。

同一份口令可以给多个人用，直到分享结束。结束条件是到达有效期、下载次数用完，或手动结束。结束时删掉临时副本。单次分享合计不超过 **300 MiB**。

## Goal

Sidebar entry **above Chat**: drop files → host copies into app temp → QR + copyable token → peer joins with 猫砂盆 and downloads over Tailcat P2P. No relay server. Host must stay online.

## Scope (v1)

- Name: **喵传** / **Miao Share** (EN)
- Nav: left rail, above 聊天 / Chat
- Right pane: full dashed drop zone; click to pick or drag-drop multi-file
- Max total payload **300 MiB**; reject oversize with a clear error
- On accept: copy into an app-managed temp dir with **renamed** files (keep original display names in the UI); delete them when the share ends
- Bundle multi-file as **one share package** (one QR / one token)
- After drop: active share view — file list, size, QR, token (copy), TTL, remaining downloads, End share
- The same QR/token is reusable by multiple peers until the share closes

### Limits

- TTL presets: **1 / 7 / 15 days**, **custom days**, **长期有效** / until I end it (no expiry until manual end or the download cap)
- Downloads: default **1**; options **unlimited / 3 / 10 / custom**
- The share ends when the TTL expires **or** the download count reaches the cap, whichever comes first, then the temp files are deleted

### Clients

- Sender and receiver are both **猫砂盆** (Tailcat Box). The QR encodes a join payload: Tailcat address + share token. Official Tailcat is out of scope for v1.

### Transport

Host listens with an ephemeral Tailcat room (the same `StartRoom` path as chat). The join payload is JSON:

```json
{"v":1,"kind":"miao","addr":"tc…","token":"…"}
```

The peer listens on its own room, dials the host, and sends a `miao-pull` TCH1 envelope on port 102 with the token and its reply address. The host checks the token and streams `miao-manifest`, `miao-chunk`, and `miao-done`. A bad token is refused and does not end the share. One transfer runs at a time; another pull waits until the current one finishes. Temp copies live under `<user-config>/tailcat-box/miao` (`TAILCAT_MIAO_DIR` overrides that).

### Loading mascot

`LoadingCat` prefers `frontend/src/assets/loading-cat.webp` (keyed alpha). `loading-cat.gif` and `loading-cat-sm.gif` are the fallbacks. It is the shared busy indicator for lobby create/connect, tunnel actions, update download, and 喵传 packing or joining.

## Non-goals (v1)

- HTTP short links / browser download from a public URL
- Official Tailcat QR compatibility
- Offline store-and-forward when the host has quit
- Payloads over 300 MiB
- Folders

## Tests

- Oversize reject before any temp copy; renamed storage plus display names; TTL and download-cap end delete the copies
- Browser fake: drop zone, active share QR/token, join, and cap cleanup
- `LoadingCat` renders the mascot when a label is shown
