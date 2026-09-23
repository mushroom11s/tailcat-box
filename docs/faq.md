# FAQ

[中文](faq.zh-CN.md) · [Back to the README](../README.md)

Usage notes for the chat room.

## What happens if several people connect to the same room address?

This is not a group chat. Chat keeps only one current peer.

Suppose A opens a room, and both B and C connect to A:

1. **Can you tell who sent a message?** No. Messages from B and C land in the same transcript. Every incoming bubble is labeled Peer (对方 in the Chinese UI). The message does not name the address, so the screen does not show whether it was B or C.
2. **Where do A's replies go?** Only to the one peer locked in now: whoever completed hello most recently. If B connects first and C connects later, the transcript shows Peer changed (已更换对方 in Chinese), and the current peer becomes C. After that, what A sends goes only to C. B does not receive it. Even if B is still sending to A, A's replies still go only to C.

So many people can drop messages into the room, but the host talks back only with the latest peer. Separate identities and replies aimed at a chosen person would have to be built separately. That does not exist today.

## Can I use a temporary address again after it is closed?

It depends on where the address came from.

- **Ephemeral address.** With the room key set to New room key, the address belongs to a temporary key minted in the process. When the process exits, or that key is discarded, the address is gone for good and cannot be connected to again.
- **Saved genkey.** A named key created and saved under Keys & DERP in Settings keeps the same address until you delete that key.
- **Delete, then create again.** After you delete the key, a new genkey is a different address. It is not the old one.

Closing the window only hides the app, so the temporary address is still live. To retire an ephemeral address, quit the process, or discard that key (for example, restart the room on New room key).
