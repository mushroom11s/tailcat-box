import { describe, expect, it } from "vitest";
import { applyRoomEvent, emptyRoom } from "./roomState";

describe("room event routing", () => {
  it("ignores another room's session id", () => {
    const room = emptyRoom("a");
    room.messages = [{ id: "m1", direction: "in", type: "text", body: "keep", at: "" }];
    const next = applyRoomEvent(room, {
      SessionID: "b",
      Kind: "message",
      Data: JSON.stringify({ id: "m2", direction: "in", type: "text", body: "nope", at: "" }),
    });
    expect(next.messages.map((msg) => msg.body)).toEqual(["keep"]);
  });

  it("keeps this room's transcript when the room is restarted", () => {
    const room = emptyRoom("a");
    room.messages = [{ id: "m1", direction: "out", type: "text", body: "keep-me", at: "" }];
    room.peer = "tc:fake-echo";
    const next = applyRoomEvent(
      { ...room, messages: room.messages.slice() },
      {
        SessionID: "a",
        Kind: "message",
        Data: JSON.stringify({
          id: "m2",
          direction: "system",
          type: "system",
          code: "room-restarted",
          body: "Room restarted. Send the new address.",
          at: "",
        }),
      },
    );
    expect(next.messages.map((msg) => msg.body)).toEqual(["keep-me", "Room restarted. Send the new address."]);
    expect(next.peer).toBe("");
  });

  it("appends a message for this room only", () => {
    const next = applyRoomEvent(emptyRoom("a"), {
      SessionID: "a",
      Kind: "message",
      Data: JSON.stringify({ id: "m2", direction: "in", type: "text", body: "hi", at: "" }),
    });
    expect(next.messages.map((msg) => msg.body)).toEqual(["hi"]);
  });
});
