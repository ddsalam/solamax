import { describe, expect, it } from "vitest";
import { worstSyncAt, worstSyncUnitId } from "./freshness";
import type { SyncRow } from "./queries";

const r = (unit_id: number, last_run: string | null): SyncRow => ({ unit_id, last_run });

describe("worstSyncAt — MIN, bukan MAX (regresi insiden Bakau 2026-07-24)", () => {
  it("SKENARIO INSIDEN: 6 agent segar + 1 mati 34 jam → melaporkan yang MATI", () => {
    const rows = [
      r(1, "2026-07-24T07:33:10Z"),
      r(2, "2026-07-22T21:30:00Z"), // Bakau — 34 jam lalu
      r(3, "2026-07-24T07:32:42Z"),
      r(4, "2026-07-24T07:33:40Z"),
      r(5, "2026-07-24T07:33:18Z"),
      r(6, "2026-07-24T07:34:24Z"),
      r(7, "2026-07-24T07:33:24Z"),
    ];
    expect(worstSyncAt([1, 2, 3, 4, 5, 6, 7], rows)).toBe("2026-07-22T21:30:00Z");
    // Perilaku LAMA (MAX) akan mengembalikan 07:34:24Z — inilah yang gagal-senyap.
    expect(worstSyncAt([1, 2, 3, 4, 5, 6, 7], rows)).not.toBe("2026-07-24T07:34:24Z");
    expect(worstSyncUnitId([1, 2, 3, 4, 5, 6, 7], rows)).toBe(2);
  });

  it("scope 1 unit: MIN ≡ MAX (tanpa regresi untuk pengawas)", () => {
    const rows = [r(1, "2026-07-24T07:33:10Z"), r(2, "2026-07-22T21:30:00Z")];
    expect(worstSyncAt([1], rows)).toBe("2026-07-24T07:33:10Z");
    expect(worstSyncUnitId([1], rows)).toBe(1);
  });

  it("hanya melihat unit ber-scope — unit di luar daftar TIDAK menurunkan hasil", () => {
    const rows = [r(1, "2026-07-24T07:33:10Z"), r(9, "2020-01-01T00:00:00Z")];
    expect(worstSyncAt([1], rows)).toBe("2026-07-24T07:33:10Z");
  });

  it("unit ber-scope TANPA baris sync → null (terburuk = tak diketahui, bukan diabaikan)", () => {
    const rows = [r(1, "2026-07-24T07:33:10Z")];
    expect(worstSyncAt([1, 2], rows)).toBeNull();
    expect(worstSyncUnitId([1, 2], rows)).toBe(2);
  });

  it("last_run null diperlakukan sama dengan tak ada baris", () => {
    expect(worstSyncAt([1, 2], [r(1, "2026-07-24T07:33:10Z"), r(2, null)])).toBeNull();
  });

  it("scope kosong → null", () => {
    expect(worstSyncAt([], [r(1, "2026-07-24T07:33:10Z")])).toBeNull();
    expect(worstSyncUnitId([], [])).toBeNull();
  });

  it("urutan baris tidak mempengaruhi hasil", () => {
    const a = [r(1, "2026-07-24T07:00:00Z"), r(2, "2026-07-23T07:00:00Z")];
    expect(worstSyncAt([1, 2], a)).toBe(worstSyncAt([1, 2], [...a].reverse()));
  });
});
