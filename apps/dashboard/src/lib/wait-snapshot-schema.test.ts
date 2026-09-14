import { describe, expect, it, vi } from "vitest";
import { waitForSnapshotV2Schema } from "./wait-snapshot-schema";

describe("dashboard K1 waits for the atomic backend schema upgrade", () => {
  it("waits on v1 and proceeds immediately when v2 becomes visible", async () => {
    const read = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleep = vi.fn(async () => {});
    await waitForSnapshotV2Schema(read, { sleep });
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("does not wait on an already upgraded database", async () => {
    const sleep = vi.fn();
    await waitForSnapshotV2Schema(async () => true, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
  it("fails within the deadline if migration never finishes", async () => {
    let time = 0;
    const sleep = vi.fn(async (ms: number) => { time += ms; });
    await expect(waitForSnapshotV2Schema(async () => false, { now: () => time, sleep, timeoutMs: 12, intervalMs: 5 })).rejects.toThrow("snapshot_v2_schema_not_ready");
    expect(time).toBe(12);
  });
  it("does not hide permission or connectivity errors as migration delay", async () => {
    const sleep = vi.fn();
    await expect(waitForSnapshotV2Schema(async () => { throw new Error("permission denied"); }, { sleep })).rejects.toThrow("permission denied");
    expect(sleep).not.toHaveBeenCalled();
  });
});
