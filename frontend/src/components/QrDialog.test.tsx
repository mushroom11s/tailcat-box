import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { LocaleProvider } from "../i18n";
import QrScanButton from "./QrScanButton";
import QrShareButton from "./QrShareButton";

afterEach(() => {
  cleanup();
});

function renderInGlass(node: ReactNode) {
  return render(
    <LocaleProvider>
      <div className="glass chat-identity">{node}</div>
    </LocaleProvider>,
  );
}

describe("QrDialog portal", () => {
  it("mounts the share dialog backdrop on document.body", async () => {
    const user = userEvent.setup();
    const view = renderInGlass(<QrShareButton value="tc:room-key" />);

    await user.click(screen.getByRole("button", { name: "Show QR code" }));
    const dialog = await screen.findByRole("dialog", { name: "QR code" });
    const backdrop = dialog.closest(".modal-backdrop");

    expect(backdrop).toBeTruthy();
    expect(backdrop?.parentElement).toBe(document.body);
    expect(view.container.querySelector(".glass")?.contains(dialog)).toBe(false);
  });

  it("mounts the scan dialog backdrop on document.body", async () => {
    const user = userEvent.setup();
    const view = renderInGlass(<QrScanButton onAccept={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    const dialog = await screen.findByRole("dialog", { name: "Scan QR code" });
    const backdrop = dialog.closest(".modal-backdrop");

    expect(backdrop).toBeTruthy();
    expect(backdrop?.parentElement).toBe(document.body);
    expect(view.container.querySelector(".glass")?.contains(dialog)).toBe(false);
  });
});
