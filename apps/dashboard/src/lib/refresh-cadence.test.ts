import { describe, expect, it } from "vitest";
import {
  REFRESH_ANALISA_S,
  REFRESH_REALTIME_S,
  refreshSecondsFor,
} from "@/lib/refresh-cadence";

describe("refreshSecondsFor", () => {
  it("konstanta: realtime lebih cepat daripada analisa (kalau tidak, seluruh aturan tak ada gunanya)", () => {
    expect(REFRESH_REALTIME_S).toBeLessThan(REFRESH_ANALISA_S);
  });

  it("subtree /monitoring = realtime — kadensi TIDAK boleh turun (ATG live)", () => {
    for (const p of ["/monitoring", "/monitoring/denah/6478111", "/monitoring/ketaatan"]) {
      expect(refreshSecondsFor(p)).toBe(REFRESH_REALTIME_S);
    }
  });

  it("halaman analisa = kadensi lambat", () => {
    for (const p of [
      "/",
      "/board",
      "/laporan-harian",
      "/admin",
      "/unit/6478111",
      "/unit/6478111/laporan/2026-07-30",
      "/unit/6478111/rincian/2026-07-30",
      "/unit/6478111/usulan/2026-07-30",
      "/unit/6478111/usulan/2026-07-30/edit",
    ]) {
      expect(refreshSecondsFor(p)).toBe(REFRESH_ANALISA_S);
    }
  });

  /**
   * KASUS KONTROL. `startsWith("/monitoring")` telanjang akan MELOLOSKAN nama-nama
   * di bawah ini sebagai realtime. Uji ini yang membuatnya berbunyi MERAH kalau
   * pencocokannya diperlonggar nanti — bukan sekadar mengulang jalur bahagia.
   */
  it("nama yang HANYA berawalan 'monitoring' bukan realtime", () => {
    for (const p of ["/monitoringx", "/monitoring-lama", "/monitoringketaatan"]) {
      expect(refreshSecondsFor(p)).toBe(REFRESH_ANALISA_S);
    }
  });

  it("bukan realtime hanya karena kata 'monitoring' muncul di tengah path", () => {
    expect(refreshSecondsFor("/unit/6478111/monitoring")).toBe(REFRESH_ANALISA_S);
  });
});
