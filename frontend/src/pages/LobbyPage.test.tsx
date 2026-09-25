import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { decodeQrFromFile } from "../lib/qrImage";
import LobbyPage from "./LobbyPage";

vi.mock("../lib/qrImage", () => ({
  decodeQrFromFile: vi.fn(),
}));

const originalClipboard = navigator.clipboard;

function setClipboard(value: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function pasteOn(target: HTMLElement, fill: (data: DataTransfer) => void) {
  const data = new DataTransfer();
  fill(data);
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  target.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  vi.mocked(decodeQrFromFile).mockReset();
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

function PeerField({ locale, onConnect = () => undefined }: { locale: "en" | "zh-CN"; onConnect?: () => void }) {
  const [peer, setPeer] = useState("");
  localStorage.setItem("tailcat-locale", locale);
  return (
    <LocaleProvider>
      <LobbyPage
        peer={peer}
        error=""
        keys={[]}
        keyName=""
        keyDraft=""
        onPeer={setPeer}
        onKey={() => undefined}
        onKeyDraft={() => undefined}
        onCreate={() => undefined}
        onCreatePermanent={() => undefined}
        onSaveKey={() => undefined}
        onConnect={onConnect}
        busy=""
      />
    </LocaleProvider>
  );
}

describe("lobby peer paste", () => {
  it("fills the peer address from pasted text or a QR image and does not connect", async () => {
    const onConnect = vi.fn();
    const user = userEvent.setup();
    render(<PeerField locale="zh-CN" onConnect={onConnect} />);
    const peer = screen.getByLabelText("对方地址（可选）") as HTMLInputElement;
    expect(peer.placeholder).toBe("粘贴地址或二维码");
    expect(screen.getByText("可以直接把二维码粘贴到上面。连接会新建一个临时房间。")).toBeTruthy();
    await user.click(peer);

    await user.paste("  tc:room\n");
    expect(peer.value).toBe("tc:room");

    await user.paste("地址 tc:peer-1 请连接");
    expect(peer.value).toBe("tc:peer-1");

    await user.paste("not-an-address");
    expect(peer.value).toBe("tc:peer-1");
    expect(screen.getByRole("alert").textContent).toBe("请粘贴以 tc 开头的 Tailcat 地址。");
    expect(onConnect).not.toHaveBeenCalled();

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce("邀请 tc:peer-9 谢谢");
    const image = new File([new Uint8Array([1, 2, 3])], "peer.png", { type: "image/png" });
    pasteOn(peer, (data) => {
      data.items.add(image);
    });
    await waitFor(() => {
      expect(peer.value).toBe("tc:peer-9");
    });
    expect(decodeQrFromFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(null);
    pasteOn(peer, (data) => {
      data.items.add(image);
    });
    expect((await screen.findByRole("alert")).textContent).toBe("这张图片里没有二维码。");
    expect(peer.value).toBe("tc:peer-9");
  });

  it("reports an empty clipboard and a clipboard that is neither text nor an image", async () => {
    const user = userEvent.setup();
    setClipboard({
      read: async () => [],
      readText: async () => "",
    });
    render(<PeerField locale="zh-CN" />);
    const peer = screen.getByLabelText("对方地址（可选）");
    await user.click(peer);
    pasteOn(peer, () => undefined);
    expect((await screen.findByRole("alert")).textContent).toBe("剪贴板是空的。");

    pasteOn(peer, (data) => {
      data.setData("text/html", "<b>hi</b>");
    });
    expect((await screen.findByRole("alert")).textContent).toBe("剪贴板里既没有图片，也没有 Tailcat 地址。");
  });

  it("accepts a Tailcat address pasted from the scan dialog", async () => {
    const user = userEvent.setup();
    setClipboard({
      read: async () =>
        [
          {
            types: ["text/plain"],
            getType: async () => new Blob(["see tc:from-dialog"], { type: "text/plain" }),
          },
        ] as unknown as ClipboardItems,
    });
    render(<PeerField locale="zh-CN" />);
    await user.click(screen.getByRole("button", { name: "扫码" }));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => {
      expect((screen.getByLabelText("对方地址（可选）") as HTMLInputElement).value).toBe("tc:from-dialog");
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.clear(screen.getByLabelText("对方地址（可选）"));
    await user.click(screen.getByRole("button", { name: "扫码" }));
    await user.keyboard("{Meta>}v{/Meta}");
    await waitFor(() => {
      expect((screen.getByLabelText("对方地址（可选）") as HTMLInputElement).value).toBe("tc:from-dialog");
    });
  });
});
