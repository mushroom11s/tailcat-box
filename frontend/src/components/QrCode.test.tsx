import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { LocaleProvider } from "../i18n";
import { MAPPINGS_KEY } from "../lib/portMappings";
import { decodeQrFromFile } from "../lib/qrImage";
import SessionCard from "./SessionCard";
import ChatPage from "../pages/ChatPage";
import TunnelPage from "../pages/TunnelPage";

vi.mock("../lib/qrImage", () => ({
  decodeQrFromFile: vi.fn(),
}));

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  localStorage.removeItem(MAPPINGS_KEY);
  vi.mocked(decodeQrFromFile).mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(MAPPINGS_KEY);
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

describe("qr share and scan", () => {
  it("shows a room QR of the raw address and fills the peer field from a scanned image", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();
    await user.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);

    expect(screen.getByRole("button", { name: "Scan QR" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const show = await screen.findByRole("button", { name: "Show QR code" });
    await waitFor(() => {
      expect(show.hasAttribute("disabled")).toBe(false);
    });
    await user.click(show);
    const dialog = await screen.findByRole("dialog", { name: "QR code" });
    const payload = dialog.querySelector(".qr-payload")?.textContent ?? "";
    expect(payload.startsWith("tc:fake-room-")).toBe(true);
    expect(payload.includes("http")).toBe(false);
    expect(payload.includes("#invite")).toBe(false);
    await waitFor(() => {
      expect(within(dialog).getByRole("img", { name: payload }).getAttribute("src")?.startsWith("data:image/png")).toBe(true);
    });
    const copyImage = within(dialog).getByRole("button", { name: "Copy" });
    expect(copyImage.classList.contains("qr-copy")).toBe(true);
    expect(copyImage.querySelector("svg")).toBeTruthy();
    expect(copyImage.closest(".qr-shot")?.querySelector("img")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(payload);

    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText, write }, configurable: true });
    await user.click(copyImage);
    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    const copied = write.mock.calls[0][0] as ClipboardItem[];
    expect(await copied[0].getType("image/png")).toBeInstanceOf(Blob);
    expect(within(dialog).getByRole("status").textContent).toBe("QR code copied.");
    expect(document.querySelector(".toast-ok .toast-message")?.textContent).toBe("QR code copied.");
    expect(writeText).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show room details" }));
    vi.mocked(decodeQrFromFile).mockResolvedValueOnce("  tc:from-qr  ");
    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    const scan = await screen.findByRole("dialog", { name: "Scan QR code" });
    const input = scan.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([1])], "code.png", { type: "image/png" }));
    await waitFor(() => {
      expect((screen.getByLabelText("Peer") as HTMLInputElement).value).toBe("tc:from-qr");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show peer QR code" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeTruthy();
  });

  it("reports a missing camera, a missing code, and an invalid code", async () => {
    const user = userEvent.setup();
    const media = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    try {
    render(
      <LocaleProvider>
        <ChatPage address="tc:room" peer="" messages={[]} roomError="" onConnect={vi.fn()} onSend={vi.fn()} onRetry={vi.fn()} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Show room details" }));
    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.click(screen.getByRole("button", { name: "Use camera" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No camera is available. Choose an image of the QR code instead.",
    );

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(null);
    const scan = screen.getByRole("dialog", { name: "Scan QR code" });
    const input = scan.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([1])], "empty.png", { type: "image/png" }));
    expect(await screen.findByText("No QR code found in that image.")).toBeTruthy();
    expect((screen.getByLabelText("Peer") as HTMLInputElement).value).toBe("");

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce("https://example.invalid");
    await user.upload(input, new File([new Uint8Array([2])], "bad.png", { type: "image/png" }));
    expect(await screen.findByText("That QR code is not a Tailcat address.")).toBeTruthy();
    expect((screen.getByLabelText("Peer") as HTMLInputElement).value).toBe("");
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
    }
  });

  it("scans a forward address and shows a QR code only for the served port", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await user.click(screen.getByRole("button", { name: "+ New mapping" }));
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await user.click(screen.getByRole("button", { name: "Start 8080" }));
    const serve = await screen.findByText(/tc:fake-port-/, { selector: ".address" });
    const addr = (serve.textContent ?? "").trim();
    await user.click(screen.getByRole("button", { name: "Show QR code" }));
    const dialog = await screen.findByRole("dialog", { name: "QR code" });
    expect(dialog.querySelector(".qr-payload")?.textContent).toBe(addr);
    await waitFor(() => {
      expect(within(dialog).getByRole("img", { name: addr }).getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "+ New mapping" }));
    await user.click(screen.getByRole("radio", { name: "Local forward" }));
    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(addr);
    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    const scan = await screen.findByRole("dialog", { name: "Scan QR code" });
    await user.upload(
      scan.querySelector('input[type="file"]') as HTMLInputElement,
      new File([new Uint8Array([3])], "forward.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe(addr);
    });
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    const detail = screen.getByRole("region", { name: "18080 → :8080" });
    expect(within(detail).getByText(addr)).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Show QR code" })).toBeNull();
  });

  it("uses 扫码 and 显示二维码 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <TunnelPage
          mappings={[
            {
              id: "serve",
              mode: "serve",
              localPort: 8080,
              remoteHost: "",
              remotePort: 0,
              peer: "",
              openBrowser: false,
            },
            {
              id: "fwd",
              mode: "forward",
              localPort: 18080,
              remoteHost: "",
              remotePort: 8080,
              peer: "tc:peer",
              openBrowser: false,
            },
          ]}
          sessions={[
            {
              ID: "port",
              Kind: "port_serve",
              Status: "running",
              Address: "tc:mine",
              CreatedAt: "",
              Err: "",
              Progress: "",
              Dangerous: false,
            },
          ]}
          links={{ serve: "port" }}
          busy={false}
          onAdd={vi.fn()}
          onStart={vi.fn()}
          onStop={vi.fn()}
          onDelete={vi.fn()}
        />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: /^8080/ }));
    expect(within(screen.getByRole("region", { name: "8080" })).getByRole("button", { name: "显示二维码" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /tc:peer/ }));
    const peerDetail = screen.getByRole("region", { name: "18080 → :8080" });
    expect(within(peerDetail).queryByRole("button", { name: "显示二维码" })).toBeNull();
    expect(within(peerDetail).queryByRole("button", { name: "显示对方的二维码" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ 新映射" }));
    await user.click(screen.getByRole("radio", { name: "本地转发" }));
    expect(screen.getByRole("button", { name: "扫码" })).toBeTruthy();
  });

  it("offers QR for an owned listen address and not for a dialed peer", () => {
    render(
      <LocaleProvider>
        <>
          <SessionCard
            session={{
              ID: "mine",
              Kind: "port_serve",
              Status: "running",
              Address: "tc:mine",
              CreatedAt: "",
              Err: "",
              Progress: "",
              Dangerous: false,
            }}
          />
          <SessionCard
            session={{
              ID: "theirs",
              Kind: "pipe_dial",
              Status: "running",
              Address: "tc:theirs",
              CreatedAt: "",
              Err: "",
              Progress: "",
              Dangerous: false,
            }}
          />
        </>
      </LocaleProvider>,
    );
    const buttons = screen.getAllByRole("button", { name: "Show QR code" });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText("tc:theirs")).toBeTruthy();
  });
});
