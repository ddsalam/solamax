import { describe, expect, it, vi } from "vitest";
import {
  MANUAL_ENTRY_KAS_SCHEMA_READY_SQL,
  TUTUP_BULAN_SCHEMA_READY_SQL,
  waitForSnapshotV2Schema,
} from "./wait-snapshot-schema";

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

describe("probe kesiapan 0053/0054 menanyakan objek yang dibaca kueri halaman", () => {
  const rapat = (sql: string) => sql.replace(/\s+/g, " ");
  it("0053 menunggu kolom manual_entry.cash_ledger_id", () => {
    const sql = rapat(MANUAL_ENTRY_KAS_SCHEMA_READY_SQL);
    expect(sql).toContain("table_name = 'manual_entry' AND column_name = 'cash_ledger_id'");
    expect(sql).toContain("table_schema = 'app'");
    expect(sql).toMatch(/AS ready$/);
  });
  it("0054 menunggu tabel tutup_bulan DAN kolom day_close.koreksi_susulan_rp", () => {
    const sql = rapat(TUTUP_BULAN_SCHEMA_READY_SQL);
    expect(sql).toContain("information_schema.tables WHERE table_schema = 'app' AND table_name = 'tutup_bulan'");
    expect(sql).toContain("table_name = 'day_close' AND column_name = 'koreksi_susulan_rp'");
    expect(sql).toMatch(/\) AND EXISTS \(/);
    expect(sql).toMatch(/AS ready$/);
  });
});
