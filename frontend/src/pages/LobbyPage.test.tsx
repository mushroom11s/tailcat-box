import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import LobbyPage from "./LobbyPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderLobby(locale: "en" | "zh-CN", onCreatePermanent: () => void) {
  localStorage.setItem("tailcat-locale", locale);
  render(
    <LocaleProvider>
      <LobbyPage
        peer=""
        error=""
        keys={[{ name: "home", source: "app" }]}
        keyName="home"
        keyDraft=""
        onPeer={() => undefined}
        onKey={() => undefined}
        onKeyDraft={() => undefined}
        onCreate={() => undefined}
        onCreatePermanent={onCreatePermanent}
        onSaveKey={() => undefined}
        onConnect={() => undefined}
        busy=""
      />
    </LocaleProvider>,
  );
}

describe("lobby permanent key", () => {
  it("labels the saved-key action Restart room and still calls onCreatePermanent", async () => {
    const onCreatePermanent = vi.fn();
    renderLobby("en", onCreatePermanent);
    const user = userEvent.setup();
    expect((screen.getByLabelText("Saved key") as HTMLSelectElement).value).toBe("home");
    await user.click(screen.getByRole("button", { name: "Restart room" }));
    expect(onCreatePermanent).toHaveBeenCalledOnce();
  });

  it("uses 重启房间 in zh-CN and still calls onCreatePermanent", async () => {
    const onCreatePermanent = vi.fn();
    renderLobby("zh-CN", onCreatePermanent);
    const user = userEvent.setup();
    expect((screen.getByLabelText("已保存的密钥") as HTMLSelectElement).value).toBe("home");
    await user.click(screen.getByRole("button", { name: "重启房间" }));
    expect(onCreatePermanent).toHaveBeenCalledOnce();
  });
});
