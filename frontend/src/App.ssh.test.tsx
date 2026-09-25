import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { getSSHDesk, removeSSHPeer, setSSHAllowAny, setSSHEnabled } from "./lib/wails";

afterEach(async () => {
  cleanup();
  const desk = await getSSHDesk();
  for (const peer of desk.Peers) {
    await removeSSHPeer(peer.Address);
  }
  await setSSHAllowAny(false, false);
  await setSSHEnabled(false);
});

describe("no-auth SSH desk", () => {
  it("stays off, then allowlists a saved device and opens an in-app shell", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tunnel" }));

    const allow = screen.getByRole("checkbox", { name: "Allow SSH" });
    expect((allow as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/not an OS password or SSH key/)).toBeTruthy();
    expect(screen.queryByText("tc:fake-noauth-ssh-desk-desk")).toBeNull();

    await user.click(allow);
    expect(await screen.findByText("tc:fake-noauth-ssh-desk-desk")).toBeTruthy();

    await user.type(screen.getByLabelText("Name"), "Laptop");
    await user.type(screen.getByLabelText("Peer address"), "tc:laptop");
    await user.click(screen.getByRole("button", { name: "Save device" }));
    await user.click(await screen.findByRole("button", { name: "SSH to this peer Laptop" }));

    const term = await screen.findByRole("textbox", { name: "Shell" });
    expect((term as HTMLTextAreaElement).value).toContain("connected");
    term.focus();
    await user.keyboard("a");
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Shell" }) as HTMLTextAreaElement).value).toContain("a");
    });

    await user.click(screen.getByRole("button", { name: "Open SSH in the system terminal Laptop" }));
    expect(await screen.findByText("Opened in the system terminal.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Shell" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Allow any peer" }));
    const start = screen.getByRole("button", { name: "Allow any peer" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Confirmation"), "ALLOW");
    await user.click(start);
    expect(await screen.findByText(/Anyone with this address gets a shell/)).toBeTruthy();
  });
});
