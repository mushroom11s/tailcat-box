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
