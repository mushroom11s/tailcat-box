import { describe, expect, it } from "vitest";
import { translate } from "../i18n/locale";
import {
  abbrevPeerLabel,
  inboundAlertBody,
  inboundAlertTitle,
  isInboundAlert,
  readingOpenTranscript,
} from "./chatNotify";

const en = (key: Parameters<typeof translate>[1]) => translate("en", key);
const zh = (key: Parameters<typeof translate>[1]) => translate("zh-CN", key);

function doc(focused: boolean, hidden = false) {
  return {
    hasFocus: () => focused,
    visibilityState: hidden ? "hidden" : "visible",
  };
}

describe("inbound alert selection", () => {
  it("alerts on inbound text, file, and voice only", () => {
    expect(isInboundAlert({ direction: "in", type: "text" })).toBe(true);
    expect(isInboundAlert({ direction: "in", type: "file" })).toBe(true);
    expect(isInboundAlert({ direction: "in", type: "voice" })).toBe(true);
    expect(isInboundAlert({ direction: "out", type: "text" })).toBe(false);
    expect(isInboundAlert({ direction: "system", type: "system" })).toBe(false);
    expect(isInboundAlert({ direction: "in", type: "system" })).toBe(false);
  });

  it("suppresses only while the open window is already on that room's transcript", () => {
    expect(readingOpenTranscript(doc(true), true)).toBe(true);
    expect(readingOpenTranscript(doc(false), true)).toBe(false);
    expect(readingOpenTranscript(doc(true, true), true)).toBe(false);
    expect(readingOpenTranscript(doc(true), false)).toBe(false);
  });
});

describe("notification copy", () => {
  it("uses an address abbreviation or the app name, never a nickname", () => {
    expect(inboundAlertTitle("tc:fake-echo", "Tailcat Box")).toBe("tc:fake-echo");
    expect(abbrevPeerLabel("tc:" + "a".repeat(40))).toBe(`tc:${"a".repeat(9)}…${"a".repeat(6)}`);
    expect(inboundAlertTitle("", "Tailcat Box")).toBe("Tailcat Box");
    expect(inboundAlertTitle("", "猫砂盆")).toBe("猫砂盆");
  });

  it("previews text and uses localized file and voice lines", () => {
    expect(inboundAlertBody({ type: "text", body: "  hello\nthere  " }, en)).toBe("hello there");
    const long = "x".repeat(120);
    const preview = inboundAlertBody({ type: "text", body: long }, en);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(80);
    expect(preview.includes(long)).toBe(false);

    expect(inboundAlertBody({ type: "file", body: "/home/me/.ssh/id_rsa" }, en)).toBe("Sent a file");
    expect(inboundAlertBody({ type: "voice", body: "AAAA-secret-audio" }, en)).toBe("Sent a voice note");
    expect(inboundAlertBody({ type: "file" }, zh)).toBe("发来一个文件");
    expect(inboundAlertBody({ type: "voice" }, zh)).toBe("发来一条语音");
  });

  it("does not put key material in the preview", () => {
    const secret = "-----BEGIN OPENSSH PRIVATE KEY-----\nsuper-secret-bytes";
    const body = inboundAlertBody({ type: "text", body: secret }, en);
    expect(body).toBe("New message");
    expect(body.includes("super-secret")).toBe(false);
    expect(inboundAlertBody({ type: "text", body: "nodekey:abcdef" }, zh)).toBe("新消息");
    expect(translate("en", "chatNotifyDenied")).toBe(
      "System notifications are off, so new messages stay in the chat.",
    );
    expect(translate("zh-CN", "chatNotifyDenied")).toBe("系统通知没开，新消息只留在聊天里。");
  });
});
