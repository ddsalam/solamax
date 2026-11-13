import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "@/lib/scope";
import type { RingkasanTagihanUnit } from "@/lib/tagihan-queries";

/**
 * S5 — ringkasan tagihan lintas SPBU (rencana 2026-11-13 U10; R21–R23).
 * Render STATIS. Yang dijaga: baris hanya dari yang diserahkan, unit tanpa
 * data ditulis "belum tersedia" (bukan nol), dan tiap angka menaut ke daftar
 * unitnya dengan tampilan yang memuat angka itu. Bahwa halaman hanya
 * menyerahkan unit dalam cakupan dijaga `tagihan-queries.test.ts` (kueri) dan
 * `getDataScope()` (tipe ber-brand). Semua nama, kode dan angka ilustratif.
 */
vi.mock("@/lib/db", () => ({ qScoped: vi.fn() }));

const { TagihanRingkasanLintas } = await import("./TagihanRingkasanLintas");
const { TAGIHAN_BELUM_TERSEDIA } = await import("@/lib/tagihan-queries");

const id = (n: number) => n as unknown as ScopedUnitId;

const siap = (unitId: number, o: { bayarTerakhir?: string | null } = {}): RingkasanTagihanUnit => ({
  unitId: id(unitId),
  tersedia: true,
  kesiapan: {
    tersedia: true,
    selesaiAt: "2026-01-10T03:00:00Z",
    selesaiWib: "2026-01-10 10:00",
    jumlahFaktur: 40,
    jumlahPembayaran: 25,
    pembayaranTerakhir: o.bayarTerakhir === undefined ? "2026-01-09" : o.bayarTerakhir,
  },
  ubin: {
    lewatJatuhTempo: { jumlah: 3, sisa: 1_111_000 },
    belumJatuhTempo: { jumlah: 5, sisa: 2_222_000 },
    terminBelumDiatur: { jumlah: 2, sisa: 3_333_000 },
    belumDitagihkan: { jumlahDokumen: 7, jumlahPelanggan: 4, total: 4_444_000 },
  },
  pembayaranTerakhir: o.bayarTerakhir === undefined ? "2026-01-09" : o.bayarTerakhir,
});

const A = { code: "1111111", name: "Unit Alfa", dotted: "11.111.11", data: siap(1) };
const B = { code: "2222222", name: "Unit Beta", dotted: "22.222.22", data: { unitId: id(2), tersedia: false } as RingkasanTagihanUnit };

const render = (baris = [A, B], terpotong = false) =>
  renderToStaticMarkup(<TagihanRingkasanLintas baris={baris} terpotong={terpotong} />);

const barisUnit = (html: string, code: string): string => {
  const awal = html.indexOf(`data-ringkasan-unit="${code}"`);
  expect(awal, `baris ${code} tidak dirender`).toBeGreaterThan(-1);
  const berikut = html.indexOf("data-ringkasan-unit=", awal + 1);
  return html.slice(awal, berikut === -1 ? undefined : berikut);
};
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

describe("baris = unit yang diserahkan, tidak lebih", () => {
  it("hanya unit yang diserahkan yang muncul", () => {
    const html = render([A]);
    expect(html.match(/data-ringkasan-unit=/g)).toHaveLength(1);
    expect(html).toContain("Unit Alfa");
    expect(html).not.toContain("Unit Beta");
    expect(html).not.toContain("2222222");
  });

  it("urutan baris mengikuti urutan yang diserahkan", () => {
    const html = render([B, A]);
    expect(html.indexOf("Unit Beta")).toBeLessThan(html.indexOf("Unit Alfa"));
  });

  it("tanpa unit sama sekali: keadaan kosong, bukan tabel kosong", () => {
    const html = render([]);
    expect(html).toContain("Tidak ada SPBU dalam cakupan Anda");
    expect(html).not.toContain("grid-head");
  });
});

describe("unit yang datanya tersedia", () => {
  const baris = barisUnit(render(), A.code);

  it("empat angka: rupiah DAN jumlah", () => {
    for (const s of ["1.111.000", "3 faktur", "2.222.000", "5 faktur", "3.333.000", "2 faktur", "4.444.000", "7 dokumen"]) {
      expect(baris, s).toContain(s);
    }
  });

  it("tanggal pembayaran terakhir dan kesegaran data", () => {
    expect(baris).toMatch(/data-ringkasan-bayar-terakhir[^>]*>9 Jan 2026/);
    // 03:00 UTC = 10.00 WIB.
    expect(baris).toMatch(/data-ringkasan-kesegaran[^>]*>10 Januari 2026[^<]*10[.:]00 WIB/);
  });

  it("🔴 tiap angka menaut ke daftar unit ITU dengan tampilan yang memuatnya", () => {
    const h = hrefs(baris);
    expect(h).toContain("/keuangan/unit/1111111/tagihan?filter=lewat_jatuh_tempo");
    expect(h).toContain("/keuangan/unit/1111111/tagihan?filter=belum_ditagihkan");
    // Belum jatuh tempo & Termin belum diatur: saringan tersempit yang memuatnya.
    expect(h.filter((x) => x === "/keuangan/unit/1111111/tagihan?filter=perlu_tindakan")).toHaveLength(2);
    // Nama unit dan "Buka" → daftar bawaan.
    expect(h.filter((x) => x === "/keuangan/unit/1111111/tagihan")).toHaveLength(2);
    expect(h).toHaveLength(6);
    // Tak satu pun tautan di baris ini menunjuk unit lain.
    for (const x of h) expect(x).toContain("/unit/1111111/");
  });

  it("belum ada pembayaran tercatat disebut, bukan dikosongkan", () => {
    const html = barisUnit(render([{ ...A, data: siap(1, { bayarTerakhir: null }) }]), A.code);
    expect(html).toContain("belum ada pembayaran tercatat");
  });
});

describe("unit tanpa siklus tagihan lengkap (KTD11)", () => {
  const baris = barisUnit(render(), B.code);

  it("menulis teks belum-tersedia di barisnya", () => {
    expect(baris).toContain("data-ringkasan-belum-tersedia");
    expect(baris).toContain(TAGIHAN_BELUM_TERSEDIA);
    expect(baris).toContain("Unit Beta");
  });

  it("🔴 tanpa angka dan tanpa tautan — bukan baris nol", () => {
    expect(baris).not.toContain("Rp");
    expect(baris).not.toContain("faktur");
    expect(baris).not.toContain("href=");
  });

  it("baris unit yang tersedia TIDAK memuat teks belum-tersedia — kontrol positif", () => {
    expect(barisUnit(render(), A.code)).not.toContain(TAGIHAN_BELUM_TERSEDIA);
  });
});

describe("peringatan terpotong", () => {
  it("muncul hanya bila batas baris terlampaui", () => {
    expect(render([A, B], true)).toContain("data-ringkasan-terpotong");
    expect(render([A, B], true)).toContain("tidak lengkap");
    expect(render([A, B], false)).not.toContain("data-ringkasan-terpotong");
  });
});
