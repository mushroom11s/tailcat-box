# FAQ

[中文](faq.zh-CN.md) · [Back to the README](../README.md)

Usage notes for the chat room.

## What happens if several people connect to the same room address?

This is not a group chat. Chat keeps only one current peer.

Suppose A opens a room, and both B and C connect to A:

1. **Can you tell who sent a message?** No. Messages from B and C land in the same transcript. Every incoming bubble is labeled Peer (对方 in the Chinese UI). The message does not name the address, so the screen does not show whether it was B or C.
2. **Where do A's replies go?** Only to the one peer locked in now: whoever completed hello most recently. If B connects first and C connects later, the transcript shows Peer changed (已更换对方 in Chinese), and the current peer becomes C. After that, what A sends goes only to C. B does not receive it. Even if B is still sending to A, A's replies still go only to C.

So many people can drop messages into the room, but the host talks back only with the latest peer. Separate identities and replies aimed at a chosen person would have to be built separately. That does not exist today.

## Can I open more than one room?

Yes. Each room has its own address, its own listener, its own current peer, and its own transcript. A message in one room does not appear in another. Listeners keep running while you look at a different room, at Tunnel, or at Settings. You can keep 8 rooms open. This version does not close a room on its own: quit the app to stop them.

Hiding the window is not quitting, so every room stays up. Quitting stops every room and retires every ephemeral address. A saved key keeps its address until you delete it. This version starts each new room on a temporary key. Deleting a saved key still destroys that address.

Inside any one of those rooms, the answer above still applies. Several people can connect to that one address, and it is still not a group chat.

The room list shows a short form of each room’s address. A local name for that room’s current peer will replace the abbreviation once peer remarks exist. A nickname for yourself is not the room name, and it is not sent to the peer.

## Can I use a temporary address again after it is closed?

It depends on where the address came from.

- **Ephemeral address.** With the room key set to New room key, the address belongs to a temporary key minted in the process. When the process exits, or that key is discarded, the address is gone for good and cannot be connected to again.
- **Saved genkey.** A named key created and saved under Keys & DERP in Settings keeps the same address until you delete that key.
- **Delete, then create again.** After you delete the key, a new genkey is a different address. It is not the old one.

Closing the window only hides the app, so the temporary address is still live. To retire an ephemeral address, quit the process, or discard that key (for example, restart the room on New room key).

## Can I set a nickname? Can the other person see it?

Yes. Settings has a nickname field. It is stored only on this computer and replaces You in your local transcript (我 in the Chinese UI). **It is not sent to the other person, and they cannot see it.** On their side, messages from you still show as Peer (对方 in Chinese). A nickname they enter only replaces You on their own screen.
