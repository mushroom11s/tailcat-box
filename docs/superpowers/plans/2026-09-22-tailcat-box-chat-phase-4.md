# Tailcat Box Phase 4 — Live voice, video, and screen share

**Goal:** Place a voice call, a video call, or a screen share with the same port 100 signaling Tailcatchat already parses, while media stays in the webview.

**Architecture:** `SendChatSignal(metaJSON)` packs `rtc-offer`, `rtc-answer`, or `rtc-hangup` as an empty-payload TCH1 frame on port 100. Inbound control frames of those types are emitted as `signal` events and are not transcript rows. The webview owns `RTCPeerConnection`, `getUserMedia`, and `getDisplayMedia`. ICE uses only `stun:stun.l.google.com:19302`, waits until gathering is complete or 5 seconds, and does not trickle candidates. Go does not link a WebRTC stack.

**Out of scope:** TURN, trickle ICE, a second simultaneous peer connection, and restoring toolbox navigation.

## Acceptance

- Voice uses `{audio: true}`. Video uses `{audio: true, video: true}`. The caller’s screen share uses `getDisplayMedia({video: true, audio: true})`. A screen answer does not capture local media.
- The dock sits beside the transcript with local preview, remote media, Hang up, and Expand / Collapse. The composer stays usable during a call.
- An inbound `rtc-offer` is ignored while this client is building an offer.
- Starting another call closes the current peer connection locally and does not send `rtc-hangup` for that replacement.
- Hang up sends `rtc-hangup` only after a link was actually signaled. An ended display-capture track hangs up.
- A failed or closed peer connection ends the link with “Live media failed. Restrictive networks have no relay for calls, so voice and video can fail while chat still works.”
- Permission failures use “Microphone access was denied.”, “Camera access was denied.”, “Screen sharing was denied.”, or “Screen sharing is unavailable on this system.”
- Fake rooms deliver signal envelopes to each other. English and 简体中文 strings cover the new controls.
- `go test ./...`, `cd frontend && npm test`, and `cd frontend && npm run build` pass.

Real two-peer media against Tailcatchat still needs two machines (or a browser plus this app) and microphone, camera, and display-capture permission. Default tests use a fake peer connection and do not open a live media path.
