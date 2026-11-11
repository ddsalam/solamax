import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KoreksiSiap } from "@/lib/transfer-kas-queries";

/**
 * Langkah konfirmasi "Jadikan transfer" (keputusan Dion 11 Nov 2026 17:54 WIB:
 * konfirmasi eksplisit wajib di SETIAP hari). Render STATIS (repo tanpa jsdom):
 * daftar awal tak punya tombol yang langsung mengoreksi, dan langkah
 * konfirmasinya menahan tombol sampai dicentang (+ alasan di hari tertutup).
 * Penolakan tanpa konfirmasi di SERVER diuji `transfer-kas-actions.guard.test.ts`.
 */
vi.mock("@/lib/transfer-kas-actions", () => ({ jadikanTransfer: vi.fn() }));

const { KoreksiTransferPanel, KonfirmasiJadikanTransfer } = await import("./KoreksiTransferPanel");

const BARIS: KoreksiSiap = {
  bankId: "28e717f3-0000-4000-8000-000000000000",
  tanggal: "2026-10-22",
  namaBank: "BCA …6811",
  rekening4: "6811",
  nominalSen: 39_997_900_000,
  keterangan: "setoran penjualan dari kas besar",
  hariTutup: true,
  bulanTutup: false,
  dicocokkan: false,
  kasId: "aaaabbbb-0000-4000-8000-000000000000",
  kasKategori: "Setoran ke Bank",
  kasKeterangan: "Setoran ke Bank",
  catatan: null,
};

const konfirmasi = (o: { k?: Partial<KoreksiSiap>; yakin?: boolean; alasan?: string; pending?: boolean } = {}) =>
  renderToStaticMarkup(
    <KonfirmasiJadikanTransfer
      k={{ ...BARIS, ...o.k }}
      unitCode="6378301"
      unitNama="Bakau"
      yakin={o.yakin ?? false}
      alasan={o.alasan ?? ""}
      pending={o.pending ?? false}
      onYakin={() => {}}
      onAlasan={() => {}}
      onKonfirmasi={() => {}}
      onBatal={() => {}}
    />,
  );
const tombolKonfirmasi = (html: string): string => /<button[^>]*data-konfirmasi-jadikan[^>]*>/.exec(html)?.[0] ?? "";

describe("daftar awal — tak ada koreksi satu klik", () => {
  it("baris siap hanya punya tombol pembuka 'Jadikan transfer…', bukan tombol konfirmasi", () => {
    const html = renderToStaticMarkup(
      <KoreksiTransferPanel code="6378301" unitNama="Bakau" siap={[{ ...BARIS, hariTutup: false }]} periksaManual={[]} bolehJadikan bolehHariTutup={false} />,
    );
    expect(html).toContain("Jadikan transfer…");
    expect(html).not.toContain("data-konfirmasi-jadikan");
  });

  it("bulan tertutup: tak menyarankan jurnal memorial (keputusan D3)", () => {
    const html = renderToStaticMarkup(
      <KoreksiTransferPanel code="6378301" unitNama="Bakau" siap={[{ ...BARIS, bulanTutup: true }]} periksaManual={[]} bolehJadikan bolehHariTutup />,
    );
    expect(html).not.toMatch(/memorial/i);
  });
});

describe("langkah konfirmasi — kedua kaki ditampilkan", () => {
  it("menampilkan unit, tanggal, nominal, Kas Besar kredit 'Setoran ke Bank', bank debet 'Pindah Buku' …6811, id8 kedua baris", () => {
    const html = konfirmasi();
    for (const s of ["Bakau", "6378301", "2026-10-22", "399.979.000", "Setoran ke Bank", "Pindah Buku", "…6811", "aaaabbbb", "28e717f3", "kredit", "debet"]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toMatch(/memorial/i);
  });

  it("hari terbuka: tombol mati sebelum dicentang, hidup sesudahnya", () => {
    const k = { hariTutup: false };
    expect(tombolKonfirmasi(konfirmasi({ k }))).toContain("disabled");
    expect(tombolKonfirmasi(konfirmasi({ k, yakin: true }))).not.toContain("disabled");
    expect(konfirmasi({ k })).not.toContain("Alasan");
  });

  it("hari tertutup: butuh centang DAN alasan tertulis", () => {
    expect(konfirmasi()).toContain("Alasan");
    expect(tombolKonfirmasi(konfirmasi({ yakin: true }))).toContain("disabled");
    expect(tombolKonfirmasi(konfirmasi({ alasan: "Ref REPORT6/7B" }))).toContain("disabled");
    expect(tombolKonfirmasi(konfirmasi({ yakin: true, alasan: "Ref REPORT6/7B" }))).not.toContain("disabled");
  });

  it("sedang diproses ⇒ tombol mati (tak terkirim dua kali)", () => {
    expect(tombolKonfirmasi(konfirmasi({ k: { hariTutup: false }, yakin: true, pending: true }))).toContain("disabled");
  });
});
