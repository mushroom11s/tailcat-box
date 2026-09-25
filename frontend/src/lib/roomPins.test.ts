import { afterEach, describe, expect, it } from "vitest";
import { forgetRoomPin, orderWithPins, readRoomPins, renameRoomPin, ROOM_PINS_KEY, toggleRoomPin, writeRoomPins } from "./roomPins";

afterEach(() => {
  localStorage.removeItem(ROOM_PINS_KEY);
});

describe("room pins", () => {
  it("puts pinned rooms above the others and keeps each group in order", () => {
    expect(orderWithPins(["b", "a", "c"], ["a", "missing"])).toEqual(["a", "b", "c"]);
    expect(orderWithPins(["b", "a"], [])).toEqual(["b", "a"]);
  });

  it("toggles, renames, and forgets a pin", () => {
    const pinned = toggleRoomPin([], "a");
    expect(toggleRoomPin(pinned, "b")).toEqual(["b", "a"]);
    expect(toggleRoomPin(["b", "a"], "b")).toEqual(["a"]);
    expect(renameRoomPin(["a", "b"], "a", "a2")).toEqual(["a2", "b"]);
    expect(forgetRoomPin(["a2", "b"], "b")).toEqual(["a2"]);
  });

  it("persists a pin list and ignores junk", () => {
    writeRoomPins(["room-1", "room-1", "room-2"]);
    expect(readRoomPins()).toEqual(["room-1", "room-2"]);
    localStorage.setItem(ROOM_PINS_KEY, "nope");
    expect(readRoomPins()).toEqual([]);
  });
});