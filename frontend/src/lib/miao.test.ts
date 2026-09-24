import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCancelReceive, browserDiscardReceive, browserJoinMiao, browserReceiveHeld, browserStartMiao, browserStartReceive, releaseBrowserReceiveHolds, resetBrowserMiao, setBrowserReceiveHold, setMiaoBrowserEmit } from "./miaoBrowser";
import {
  acceptMiaoCode,
  downloadsLeft,
  encodeJoin,
  MAX_SHARE_BYTES,
  parseJoin,
  parseReceiveJob,
  receivePercent,
  remainingTTL,
  shareTooLarge,
  upsertReceiveJob,
  type ReceiveJob,
} from "./miao";

afterEach(() => {
  resetBrowserMiao();
});

describe("miao share helpers", () => {
  it("rejects a total above 300 MiB", () => {
    expect(shareTooLarge([MAX_SHARE_BYTES])).toBe(false);
    expect(shareTooLarge([MAX_SHARE_BYTES + 1])).toBe(true);
    expect(shareTooLarge([200 * 1024 * 1024, 100 * 1024 * 1024 + 1])).toBe(true);
    expect(shareTooLarge([1024, 2048])).toBe(false);
  });

  it("parses a join payload and rejects a bare address", () => {
    const raw = JSON.stringify({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(parseJoin(`  ${raw}  `)).toEqual({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(acceptMiaoCode(raw)).toEqual({ ok: true, value: raw });
    expect(parseJoin("tc:room")).toBeNull();
    expect(acceptMiaoCode("tc:room")).toEqual({ ok: false });
  });

  it("round-trips a compact share code and rejects garbage", () => {
    expect(encodeJoin("tc:room", "abc")).toBe("mw1.AAAHdGM6cm9vbQADYWJj");
    expect(parseJoin("  mw1.AAAHdGM6cm9vbQADYWJj\n")).toEqual({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(encodeJoin("tcEREREQ", "abcd")).toBe("mw1.AQAEEREREQAEYWJjZA");
    expect(parseJoin("mw1.AQAEEREREQAEYWJjZA")).toEqual({ v: 1, kind: "miao", addr: "tcEREREQ", token: "abcd" });
    const addr = `tc${bytesToBase64Url(new Uint8Array(80).fill(0x11))}`;
    const token = "0123456789abcdef0123456789abcdef";
    const compact = encodeJoin(addr, token);
    expect(compact?.startsWith("mw1.")).toBe(true);
    expect(parseJoin(compact ?? "")).toEqual({ v: 1, kind: "miao", addr, token });
    const legacy = JSON.stringify({ v: 1, kind: "miao", addr, token });
    expect((compact ?? "").length).toBeLessThan(legacy.length);
    expect(encodeJoin("room", "abc")).toBeNull();
    for (const bad of ["", "mw1.", "mw1.!!!!", "mw1.YQ", "nope"]) {
      expect(parseJoin(bad)).toBeNull();
      expect(acceptMiaoCode(bad)).toEqual({ ok: false });
    }
  });

  it("joins a legacy JSON code and a compact code", async () => {
    const share = await browserStartMiao([{ name: "a.txt", path: "", dataBase64: btoa("hi") }], 1, false, 2);
    expect(share.payload.startsWith("mw1.")).toBe(true);
    expect(parseJoin(share.payload)).toEqual({ v: 1, kind: "miao", addr: share.address, token: share.token });
    const legacy = JSON.stringify({ v: 1, kind: "miao", addr: share.address, token: share.token });
    expect(browserJoinMiao(legacy).files[0]?.name).toBe("a.txt");
    expect(browserJoinMiao(share.payload).files[0]?.name).toBe("a.txt");
  });

  it("counts remaining downloads and treats 0 as unlimited", () => {
    expect(downloadsLeft(1, 0)).toBe(1);
    expect(downloadsLeft(1, 1)).toBe(0);
    expect(downloadsLeft(0, 4)).toBeNull();
  });

  it("keeps receive progress and does not rewind a job", () => {
    const connecting: ReceiveJob = { id: "a", status: "connecting", bytesDone: 0, bytesTotal: 0, files: [], dest: "/tmp" };
    const queued: ReceiveJob = { ...connecting, id: "b", status: "queued" };
    const partial: ReceiveJob = {
      id: "a",
      status: "downloading",
      bytesDone: 40,
      bytesTotal: 100,
      files: [{ name: "notes.txt", size: 100 }],
      dest: "/tmp",
    };
    let jobs = upsertReceiveJob([], connecting);
    jobs = upsertReceiveJob(jobs, queued);
    jobs = upsertReceiveJob(jobs, partial);
    jobs = upsertReceiveJob(jobs, { ...connecting, status: "connecting" });
    jobs = upsertReceiveJob(jobs, { ...partial, bytesDone: 10 });
    expect(jobs.map((job) => job.id)).toEqual(["b", "a"]);
    const active = jobs.find((job) => job.id === "a");
    const waiting = jobs.find((job) => job.id === "b");
    if (!active || !waiting) {
      throw new Error("missing jobs");
    }
    expect(active).toMatchObject({ status: "downloading", bytesDone: 40, bytesTotal: 100 });
    expect(active.files[0]?.name).toBe("notes.txt");
    expect(waiting.status).toBe("queued");
    expect(receivePercent(active)).toBe(40);
    expect(receivePercent(waiting)).toBe(0);
    const done = upsertReceiveJob(jobs, { ...partial, status: "done", bytesDone: 100, error: "" });
    const finished = done.find((job) => job.id === "a");
    if (!finished) {
      throw new Error("missing finished job");
    }
    expect(finished.status).toBe("done");
    expect(receivePercent(finished)).toBe(100);
    const stuck = upsertReceiveJob(done, { ...partial, status: "downloading", bytesDone: 80 });
    expect(stuck.find((job) => job.id === "a")?.status).toBe("done");
    const interrupted = upsertReceiveJob(jobs, { ...partial, status: "interrupted", bytesDone: 40, resumable: true, payload: "mw1.keep" });
    const resumed = upsertReceiveJob(interrupted, { ...partial, status: "connecting", bytesDone: 40, payload: "mw1.keep" });
    expect(resumed.find((job) => job.id === "a")).toMatchObject({ status: "connecting", bytesDone: 40, payload: "mw1.keep" });
    expect(parseReceiveJob(JSON.stringify({ ...partial, status: "interrupted", resumable: true }))?.status).toBe("interrupted");
    expect(parseReceiveJob("{")).toBeNull();
  });

  it("upserts a receive job whose files are null or missing", () => {
    const nullFiles = {
      id: "null-files",
      status: "connecting",
      bytesDone: "12",
      bytesTotal: null,
      files: null,
      saved: null,
      dest: "/tmp/in",
    } as unknown as ReceiveJob;
    let thrown: unknown;
    let jobs: ReceiveJob[] = [];
    try {
      jobs = upsertReceiveJob([], nullFiles);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();
    expect(jobs[0]?.files).toEqual([]);
    expect(jobs[0]?.saved).toEqual([]);
    expect(jobs[0]?.bytesDone).toBe(12);
    expect(jobs[0]?.bytesTotal).toBe(0);
    const updated = upsertReceiveJob(jobs, { ...nullFiles, status: "downloading" });
    expect(updated[0]?.status).toBe("downloading");
    expect(updated[0]?.files).toEqual([]);

    const missing = upsertReceiveJob([], { id: "missing-files", status: "queued", dest: "" } as ReceiveJob);
    expect(missing[0]?.files).toEqual([]);

    const parsed = parseReceiveJob({ id: "obj", status: "downloading", files: null, saved: null, bytesDone: 3, bytesTotal: 9 });
    expect(parsed?.files).toEqual([]);
    expect(parsed?.saved ?? []).toEqual([]);
    expect(parsed?.status).toBe("downloading");

    const wrapped = parseReceiveJob({
      result: { ID: "wrap", Status: "connecting", Files: null, BytesDone: 1, BytesTotal: 4, Dest: "/tmp" },
    });
    expect(wrapped).toMatchObject({ id: "wrap", status: "connecting", files: [], bytesDone: 1, bytesTotal: 4, dest: "/tmp" });
  });

  it("queues a second receive for the same share and reports progress", async () => {
    const seen: ReceiveJob[] = [];
    setMiaoBrowserEmit((ev) => {
      if (ev.Kind !== "miao-receive" || !ev.Data) {
        return;
      }
      const job = parseReceiveJob(ev.Data);
      if (job) {
        seen.push(job);
      }
    });
    const share = await browserStartMiao([{ name: "a.txt", path: "", dataBase64: btoa("hello") }], 1, false, 3);
    const other = await browserStartMiao([{ name: "b.txt", path: "", dataBase64: btoa("yo") }], 1, false, 1);
    const first = browserStartReceive(share.payload, "/tmp/in");
    const second = browserStartReceive(share.payload, "/tmp/other");
    const same = browserStartReceive(share.payload, "/tmp/in");
    const parallel = browserStartReceive(other.payload, "/tmp/in");
    expect(first.status).toBe("connecting");
    expect(second.status).toBe("queued");
    expect(same.id).toBe(first.id);
    expect(parallel.status).toBe("connecting");
    await vi.waitFor(() => {
      expect(seen.some((job) => job.id === first.id && job.status === "downloading" && job.bytesDone > 0 && job.bytesDone < job.bytesTotal)).toBe(true);
      expect(seen.some((job) => job.id === second.id && job.status === "queued")).toBe(true);
      expect(seen.some((job) => job.id === first.id && job.status === "done" && job.bytesDone === job.bytesTotal)).toBe(true);
      expect(seen.some((job) => job.id === second.id && job.status === "downloading")).toBe(true);
      expect(seen.some((job) => job.id === second.id && job.status === "done")).toBe(true);
      expect(seen.some((job) => job.id === parallel.id && job.status === "downloading")).toBe(true);
    });
  });

  it("continues a partial download from the bytes already received", async () => {
    const seen: ReceiveJob[] = [];
    setMiaoBrowserEmit((ev) => {
      if (ev.Kind !== "miao-receive" || !ev.Data) {
        return;
      }
      const job = parseReceiveJob(ev.Data);
      if (job) {
        seen.push(job);
      }
    });
    setBrowserReceiveHold(true);
    try {
      const share = await browserStartMiao([{ name: "a.txt", path: "", dataBase64: btoa("hello-resume") }], 1, false, 3);
      const first = browserStartReceive(share.payload, "/tmp/in");
      await vi.waitFor(() => {
        expect(browserReceiveHeld()).toBeGreaterThan(0);
      });
      releaseBrowserReceiveHolds();
      await vi.waitFor(() => {
        expect(seen.some((job) => job.id === first.id && job.status === "downloading" && job.bytesDone > 0 && job.bytesDone < job.bytesTotal)).toBe(true);
      });
      browserCancelReceive(first.id);
      const stopped = seen.find((job) => job.id === first.id && job.status === "interrupted");
      if (!stopped || stopped.bytesDone <= 0) {
        throw new Error("missing partial");
      }
      const again = browserStartReceive(share.payload, "/tmp/in");
      expect(again.id).toBe(first.id);
      expect(again.bytesDone).toBe(stopped.bytesDone);
      expect(again.bytesDone).toBeGreaterThan(0);
      setBrowserReceiveHold(false);
      await vi.waitFor(() => {
        expect(seen.some((job) => job.id === first.id && job.status === "done" && job.bytesDone === job.bytesTotal)).toBe(true);
      });
      browserDiscardReceive(first.id);
    } finally {
      setBrowserReceiveHold(false);
      releaseBrowserReceiveHolds();
    }
  });

  it("formats a finite TTL and forever", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    expect(remainingTTL("", true, now)).toEqual({ kind: "forever" });
    expect(remainingTTL("2026-09-24T00:00:00Z", false, now)).toEqual({ kind: "expired" });
    expect(remainingTTL("2026-09-25T01:02:00Z", false, now)).toEqual({ kind: "left", days: 1, hours: 1, minutes: 2 });
  });
});

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
