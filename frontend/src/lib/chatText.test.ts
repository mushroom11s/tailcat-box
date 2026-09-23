import { describe, expect, it } from "vitest";
import { translate } from "../i18n/locale";
import { localizeChatError, systemText } from "./chatText";

describe("chat text", () => {
  it("keeps they're hear meow in zh-CN and translates peer changed", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("zh-CN", key);
    expect(systemText("hear-meow", "they're hear meow", t)).toBe("they're hear meow");
    expect(systemText("peer-changed", "Peer changed", t)).toBe("已更换对方");
    expect(localizeChatError("Paste a Tailcat address that starts with tc.", t)).toBe("请粘贴以 tc 开头的 Tailcat 地址。");
  });
});

describe("multi-select delete strings", () => {
  it("resolves EN and ZH select chrome with {n} placeholders", () => {
    expect(translate("en", "chatSelectToggle")).toBe("Select message");
    expect(translate("en", "chatSelectCount")).toBe("{n} selected");
    expect(translate("en", "chatSelectDelete")).toBe("Delete");
    expect(translate("en", "chatSelectClose")).toBe("Close");
    expect(translate("en", "chatSelectDeleteConfirm")).toBe(
      "Delete {n} local messages? Your peer is not affected.",
    );
    expect(translate("en", "chatSelectDeleteError")).toBe("Could not delete some local messages.");

    expect(translate("zh-CN", "chatSelectToggle")).toBe("选择消息");
    expect(translate("zh-CN", "chatSelectCount")).toBe("已选择 {n} 条");
    expect(translate("zh-CN", "chatSelectDelete")).toBe("删除");
    expect(translate("zh-CN", "chatSelectClose")).toBe("关闭");
    expect(translate("zh-CN", "chatSelectDeleteConfirm")).toBe("删除 {n} 条本机记录？对方不受影响。");
    expect(translate("zh-CN", "chatSelectDeleteError")).toBe("部分本机记录删除失败。");
  });

  it("keeps burn status strings", () => {
    expect(translate("en", "chatBurnRemoved")).toBe("Removed on their side after they open it.");
    expect(translate("en", "chatBurnKept")).toBe("They may keep a copy.");
    expect(translate("zh-CN", "chatBurnRemoved")).toBe("对方打开后，他们那边会删掉。");
    expect(translate("zh-CN", "chatBurnKept")).toBe("对方可能会留下一份。");
  });
});
