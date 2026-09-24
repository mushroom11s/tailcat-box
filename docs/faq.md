# FAQ

[中文](faq.zh-CN.md) · [Back to the README](../README.md)

Usage notes for the chat room.

## What happens if several people connect to the same room address?

This is not a group chat. Chat keeps only one current peer.

Suppose A opens a room, and both B and C connect to A:

1. **Can you tell who sent a message?** No. Messages from B and C land in the same transcript. Every incoming bubble is labeled Peer (对方 in the Chinese UI), or your local remark for the current peer if you set one. That remark stays on this computer. The message does not name the address, so the screen does not show whether it was B or C.
2. **Where do A's replies go?** Only to the one peer locked in now: whoever completed hello most recently. If B connects first and C connects later, the transcript shows Peer changed (已更换对方 in Chinese), and the current peer becomes C. After that, what A sends goes only to C. B does not receive it. Even if B is still sending to A, A's replies still go only to C.

So many people can drop messages into the room, but the host talks back only with the latest peer. Separate identities and replies aimed at a chosen person would have to be built separately. That does not exist today.

## Can I open more than one room?

Yes. Each room has its own address, its own listener, its own current peer, and its own transcript. A message in one room does not appear in another. Listeners keep running while you look at a different room, at Tunnel, or at Settings. You can keep 8 rooms open. This version does not close a room on its own: quit the app to stop them.

Hiding the window is not quitting, so every room stays up. Quitting stops every room and retires every ephemeral address. A saved key keeps its address until you delete it. This version starts each new room on a temporary key. Deleting a saved key still destroys that address.

Inside any one of those rooms, the answer above still applies. Several people can connect to that one address, and it is still not a group chat.

The room list uses your local remark for that room’s current peer when you have set one. Otherwise it shows a short form of the room address. A nickname for yourself is not the room name, and it is not sent to the peer. A remark is not sent either.

## Can I use a temporary address again after it is closed?

It depends on where the address came from.

- **Ephemeral address.** A room opened with Create temporary room uses a temporary key minted in the process. When the process exits, the address is gone for good and cannot be connected to again.
- **Saved genkey.** A named key saved under Keys & DERP in Settings, or from the lobby’s permanent-key panel, keeps the same address until you delete that key. Restart room in that panel opens another sidebar room on the chosen saved key.
- **Delete, then create again.** After you delete the key, a new genkey is a different address. It is not the old one.

Closing the window only hides the app, so the temporary address is still live. To retire an ephemeral address, quit the process.

## Can I set a nickname? Can the other person see it?

Yes. Settings has a nickname field. It is stored only on this computer and replaces You in your local transcript (我 in the Chinese UI). **It is not sent to the other person, and they cannot see it.** On their side, messages from you still show as Peer (对方 in Chinese). A nickname they enter only replaces You on their own screen.

## Can I set a remark for the other person? Can they see it?

Yes. The chat room has a Remark field. It stores a display name on this computer for that person's Tailcat address, and incoming bubbles use it instead of Peer (对方 in the Chinese UI). **It is never sent, and the other person cannot see it.** This is separate from the Settings nickname, which only replaces You on messages you send. Clearing the field removes the remark. An empty remark shows Peer again.
