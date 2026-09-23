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

  it("appends a message for this room only", () => {
    const next = applyRoomEvent(emptyRoom("a"), {
      SessionID: "a",
      Kind: "message",
      Data: JSON.stringify({ id: "m2", direction: "in", type: "text", body: "hi", at: "" }),
    });
    expect(next.messages.map((msg) => msg.body)).toEqual(["hi"]);
  });
});
