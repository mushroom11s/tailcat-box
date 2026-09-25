import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { decodeQrFromFile } from "../lib/qrImage";
import ChatPage from "./ChatPage";

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

function PeerRoom({ locale }: { locale: "en" | "zh-CN" }) {
  const [peer, setPeer] = useState("");
  localStorage.setItem("tailcat-locale", locale);
  return (
    <LocaleProvider>
      <ChatPage
        address=""
        peer=""
        messages={[]}
        roomError=""
        initialPeerDraft={peer}
        onRoomDraft={(draft) => setPeer(draft.peer)}
        onConnect={vi.fn()}
        onSend={vi.fn()}
        onRetry={vi.fn()}
      />
    </LocaleProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  vi.mocked(decodeQrFromFile).mockReset();
});

describe("chat peer paste", () => {
  it("shows that an address or a QR code can be pasted", () => {
    render(<PeerRoom locale="zh-CN" />);
    const peer = screen.getByLabelText("对方") as HTMLInputElement;
    expect(peer.placeholder).toBe("粘贴地址或二维码");
    expect(screen.getByText("把对方的 Tailcat 地址或二维码图片粘贴到这里。")).toBeTruthy();

    cleanup();
    render(<PeerRoom locale="en" />);
    const english = screen.getByLabelText("Peer") as HTMLInputElement;
    expect(english.placeholder).toBe("Paste an address or a QR code");
    expect(screen.getByText("Paste a Tailcat address, or paste a QR code image.")).toBeTruthy();
  });

  it("fills the peer field from pasted text or a QR image and does not connect", async () => {
    const user = userEvent.setup();
    render(<PeerRoom locale="zh-CN" />);
    const peer = screen.getByLabelText("对方") as HTMLInputElement;
    await user.click(peer);

    await user.paste("  tc:room\n");
    expect(peer.value).toBe("tc:room");

    await user.paste("地址 tc:peer-1 请连接");
    expect(peer.value).toBe("tc:peer-1");

    await user.paste("not-an-address");
    expect(peer.value).toBe("tc:peer-1");
    expect(screen.getByRole("alert").textContent).toBe("请粘贴以 tc 开头的 Tailcat 地址。");

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

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(null);
    pasteOn(peer, (data) => {
      data.items.add(image);
    });
    expect((await screen.findByRole("alert")).textContent).toBe("这张图片里没有二维码。");
    expect(peer.value).toBe("tc:peer-9");
  });

  it("reports an empty clipboard", async () => {
    const user = userEvent.setup();
    setClipboard({
      read: async () => [],
      readText: async () => "",
    });
    render(<PeerRoom locale="en" />);
    const peer = screen.getByLabelText("Peer");
    await user.click(peer);
    pasteOn(peer, () => undefined);
    expect((await screen.findByRole("alert")).textContent).toBe("The clipboard is empty.");
  });
});
