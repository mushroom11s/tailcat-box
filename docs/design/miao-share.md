# 喵传 (Mew Share)

**Status:** v1 implemented.  
**Product:** Tailcat Box / 猫砂盆

## 中文摘要

侧栏在「聊天」上面加一项 **喵传**。把文件拖进右侧虚线区域（或点一下选择）。合计不超过 **300 MiB** 时，猫砂盆把文件复制到自己管理的临时目录里，磁盘上的文件名会换成随机名，界面仍显示原来的名字。更大的一份不复制，直接从用户选中的原路径发送，分享期间这些文件不能移动。然后给出一个二维码和可复制的口令。对方也用猫砂盆，扫码或粘贴口令后，通过 Tailcat 点对点把这一包文件下载下来。没有中转服务器。分享的人必须一直在线。

同一份口令可以给多个人用，直到**这一份**分享结束。结束条件是到达有效期、下载次数用完，或手动结束。结束时只删掉这一份的临时副本；按原路径分享的文件留在原地。可以同时开多份分享，每份有自己的文件包、二维码、口令、有效期、下载次数和结束按钮。

## Goal

Sidebar entry **above Chat**: drop files → host copies shares up to 300 MiB into app temp, and leaves larger path-backed shares on the original files → QR + copyable token → peer joins with 猫砂盆 and downloads over Tailcat P2P. No relay server. Host must stay online.

## Scope (v1)

- Name: **喵传** / **Mew Share** (EN)
- Nav: left rail, above 聊天 / Chat
- Right pane: dashed drop zone stays available; click to pick or drag-drop multi-file
- The host can run **several shares at once**. Each share has its own package, QR/token, TTL, download limit, and End control
- Totals **at or under 300 MiB** are copied into an app-managed temp dir with **renamed** files (keep original display names in the UI); delete that share's copies when **that** share ends
- Totals **over 300 MiB** whose files all have original paths are not copied. The whole share is served from those paths. If a file is moved, renamed, or deleted, the download fails with a clear error instead of hanging
- In-memory drops with no path still cannot exceed 300 MiB
- Bundle multi-file as **one share package** (one QR / one token)
- After drop: the new share joins the active list. The drop zone stays so another share can start. Each card shows file list, size, QR, token (copy), TTL, remaining downloads, End share
- The same QR/token is reusable by multiple peers until that share closes. A peer joins one token
- Ending one share does not stop the others

### Limits

- TTL presets: **1 / 7 / 15 days**, **custom days**, **长期有效** / until I end it (no expiry until manual end or the download cap)
- Downloads: default **1**; options **unlimited / 3 / 10 / custom**
- The share ends when the TTL expires **or** the download count reaches the cap, whichever comes first, then the temp files are deleted

### Clients

- Sender and receiver are both **猫砂盆** (Tailcat Box). The QR encodes a join payload: Tailcat address + share token. Official Tailcat is out of scope for v1.

### Transport

Host listens with an ephemeral Tailcat room (the same `StartRoom` path as chat). The outward share code, used by the QR and Copy, is `mw1.` plus unpadded base64url of the Tailcat address and share token. The prefix implies `v=1` and `kind=miao`. A canonical `tc` + base64url address is stored as its raw bytes; any other `tc…` address is stored as UTF-8. Peers also still accept the legacy JSON:

```json
{"v":1,"kind":"miao","addr":"tc…","token":"…"}
```

The peer listens on its own room, dials the host, and sends a `miao-pull` TCH1 envelope on port 102 with the token and its reply address. The host checks the token and streams `miao-manifest`, `miao-chunk`, and `miao-done`. A `miao-pull` may include `resume: [{id, offset}]`. The host then starts each file at that byte offset. An omitted `resume` still starts at 0, so older peers keep working. A bad token is refused and does not end the share. One transfer runs at a time per share; another pull for that share waits until the current one finishes, and a queued pull keeps the offsets it asked for. While it waits, the host sends `miao-queued` so the receiver can show Queued. Temp copies live under `<user-config>/tailcat-box/miao` (`TAILCAT_MIAO_DIR` overrides that). The receiver's resume index lives in `incoming/` under that directory and is kept across restarts.

### Receive jobs

The receive tab keeps the code field and Download button available. Each Download starts a new job and clears the code. `StartMiaoReceive` returns the job id immediately. Different shares download together. A second job for a share the host is already sending stays queued until that pull finishes, then its progress moves.

Chunk writes emit Tailcat events with Kind `miao-receive` and JSON `{id,status,bytesDone,bytesTotal,files,error,dest,saved,payload,resumable}`. Status is `connecting`, `queued`, `downloading`, `done`, `failed`, `cancelled`, or `interrupted`. Each card shows the file names once the manifest arrives, the size, a progress bar, and that status.

The first download asks for a folder. Later jobs reuse it. A job can change its folder while it is still connecting or queued and no bytes have been kept. An in-progress job can be cancelled.

### Resume

A download that stops because the peer disconnects, the app quits, or the transfer errors keeps the bytes already received. The receiver writes `<dest>/.tailcat-miao/<fingerprint>/<id>.part` plus `state.json`. The fingerprint is the share address and token. The sidecar stores the job id, code, destination, and each file's size and offset. The same record is copied under the app `incoming/` index so the receive list can come back after a restart.

Joining the same code into the same folder continues that job instead of starting a second copy. The card shows **继续 / Resume** and the progress already reached. A finished file is renamed into the destination and the partial state is removed. Discard, or a cancel that received nothing, deletes the partials. If the host has ended the share, Resume reports that and Discard still removes the leftover.

A partial whose length or declared size does not match is deleted and fetched again from byte 0. If the bytes are the right length but fail the checksum, the partial is dropped and the error says the download will start over. Resume state is for this device and this folder; copying a partial to another computer is out of scope.

### Loading mascot

`LoadingCat` prefers `frontend/src/assets/loading-cat.webp` (keyed alpha). `loading-cat.gif` and `loading-cat-sm.gif` are the fallbacks. It is the shared busy indicator for lobby create/connect, tunnel actions, update download, and 喵传 packing or joining.

## Non-goals (v1)

- HTTP short links / browser download from a public URL
- Official Tailcat QR compatibility
- Offline store-and-forward when the host has quit
- Copying a share over 300 MiB into app temp
- Folders

## Tests

- Shares over 300 MiB stay on the original paths; a move, rename, or delete fails clearly; renamed storage plus display names for copied shares; TTL and download-cap end delete that share's copies and leave by-reference originals in place
- Concurrent shares stay independent: ending or exhausting one leaves the others and their temp files
- Browser fake: drop zone stays beside the active list, each share has its own QR/token, join targets one token, and cap cleanup removes only that share
- Receive jobs: progress events advance bytes, a second pull of the same share is queued, and a different share downloads without waiting
- Resume: a second pull continues from the partial offset, progress events start at that offset, a short or mismatched partial is fetched again, and corrupted bytes fail clearly before a clean retry
- `LoadingCat` renders the mascot when a label is shown
