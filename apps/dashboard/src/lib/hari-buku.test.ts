import { describe, expect, it } from "vitest";
import { addDays } from "./periods";
import { tentukanHariBuku } from "./hari-buku";

/**
 * Aturan tanggal buku (KTD5, R22, R28) — satu fungsi murni untuk lima jalur
 * tulis baru. Kasus dari rencana 2026-10-29 U2.
 */
const rentang = (dari: string, sampai: string): string[] => {
  const out: string[] = [];
  for (let d = dari; d <= sampai; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("tentukanHariBuku", () => {
  it("AE9 — 1 Okt s.d. 2 Nov tertutup ⇒ tanggal 2 Okt dibukukan 3 Nov, terdorong maju", () => {
    const h = tentukanHariBuku({
      tanggal: "2026-10-02",
      cutOver: "2026-10-01",
      tertutup: rentang("2026-10-01", "2026-11-02"),
    });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2026-11-03", terdorongMaju: true });
  });

  it("hari terbuka ⇒ hari buku = tanggalnya, tidak terdorong (tak perlu kode alasan)", () => {
    const h = tentukanHariBuku({ tanggal: "2026-10-05", cutOver: "2026-10-01", tertutup: ["2026-10-04"] });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2026-10-05", terdorongMaju: false });
  });

  it("R22 — tanggal sebelum cut-over ⇒ pra-cut-over, BUKAN maju ke hari terbuka", () => {
    // Dibedakan dari "maju": mutasi September tidak boleh menumpuk di 1 Okt —
    // saldo pembuka sudah memuatnya (§10.24 butir 2, dihitung ganda).
    const h = tentukanHariBuku({ tanggal: "2026-09-30", cutOver: "2026-10-01", tertutup: [] });
    expect(h).toEqual({ status: "pra-cut-over", cutOver: "2026-10-01" });
  });

  it("tanggal = cut-over ⇒ dibukukan (saldo pembuka berlaku pada AWAL hari itu)", () => {
    const h = tentukanHariBuku({ tanggal: "2026-10-01", cutOver: "2026-10-01", tertutup: [] });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2026-10-01", terdorongMaju: false });
  });

  it("hari tanpa baris day_close ⇒ dianggap TERBUKA (ketiadaan baris ≠ tertutup, §10.15)", () => {
    // Daftar `tertutup` hanya memuat baris berstatus closed; hari yang tak pernah
    // dibuka tak punya baris sama sekali, jadi tak ada di daftar.
    const h = tentukanHariBuku({
      tanggal: "2026-10-10",
      cutOver: "2026-10-01",
      tertutup: ["2026-10-09", "2026-10-11"],
    });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2026-10-10", terdorongMaju: false });
  });

  it("tanpa cut-over (null) ⇒ tak ada batas bawah — sama dengan simpanMutasiKas hari ini", () => {
    const h = tentukanHariBuku({ tanggal: "2025-01-01", cutOver: null, tertutup: [] });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2025-01-01", terdorongMaju: false });
  });

  it("melintasi akhir bulan & tahun", () => {
    const h = tentukanHariBuku({
      tanggal: "2026-12-30",
      cutOver: null,
      tertutup: ["2026-12-30", "2026-12-31"],
    });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2027-01-01", terdorongMaju: true });
  });

  it("hari tertutup SEBELUM tanggal transaksi tidak berpengaruh", () => {
    const h = tentukanHariBuku({ tanggal: "2026-10-05", cutOver: null, tertutup: ["2026-10-01", "2026-10-04"] });
    expect(h).toEqual({ status: "dibukukan", hariBuku: "2026-10-05", terdorongMaju: false });
  });

  it("tanggal tak berbentuk YYYY-MM-DD ditolak keras, bukan ditebak", () => {
    expect(() => tentukanHariBuku({ tanggal: "2026-10-2", cutOver: null, tertutup: [] })).toThrow();
    expect(() => tentukanHariBuku({ tanggal: "2026-10-02", cutOver: "1/10/2026", tertutup: [] })).toThrow();
    expect(() => tentukanHariBuku({ tanggal: "2026-10-02", cutOver: null, tertutup: ["2026-10-2"] })).toThrow();
  });
});
