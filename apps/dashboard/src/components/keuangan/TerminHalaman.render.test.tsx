import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "@/lib/scope-rule";
import type { PelangganTerminRow } from "@/lib/termin-queries";
import { CONTOH_KESIAPAN } from "./TagihanContoh";

/**
 * HALAMAN Atur termin (S4) dirender dari komponen server-nya dengan scope,
 * wewenang dan kueri TIRUAN: daftar pelanggan bawaan vs `?semua=1`, dan bahwa
 * halaman ini tidak meminta "belum ditagihkan". Aturan populasinya sendiri
 * (`pelangganTerminBawaan`) TIDAK ditiru. Semua nilai ilustratif.
 */
const mocks = vi.hoisted(() => ({
  getDataScope: vi.fn(),
  getTagihanRingkasanUnit: vi.fn(),
  getPelangganUntukTermin: vi.fn(),
  getTerminUnit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/UnitDateFilters", () => ({ UnitDateFilters: () => null }));
vi.mock("@/lib/db", () => ({ qScoped: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock("@/lib/scope", () => ({ getDataScope: mocks.getDataScope }));
vi.mock("@/lib/termin-actions", () => ({
  tetapkanTerminUnit: vi.fn(),
  tetapkanTerminPelanggan: vi.fn(),
  hapusTerminPelanggan: vi.fn(),
}));
vi.mock("@/lib/tagihan-queries", () => ({
  TAGIHAN_BELUM_TERSEDIA: "Data tagihan belum tersedia untuk SPBU ini",
  getTagihanRingkasanUnit: mocks.getTagihanRingkasanUnit,
}));
vi.mock("@/lib/termin-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/termin-queries")>()),
  getPelangganUntukTermin: mocks.getPelangganUntukTermin,
  getTerminUnit: mocks.getTerminUnit,
}));

const { default: AturTerminPage } = await import("@/app/(app)/keuangan/unit/[code]/tagihan/termin/page");

const unit = { unit_id: 7 as ScopedUnitId, code: "6400001", name: "SPBU Contoh" };
const plg = (kodePelanggan: string, kelas: number | null, o: Partial<PelangganTerminRow> = {}): PelangganTerminRow => ({
  kodePelanggan, namaPelanggan: `Pelanggan ${kodePelanggan}`, diMaster: true, kelas,
  terminHari: null, diaturOleh: null, diaturAt: null, ...o,
});
const MASTER = [
  plg("PIUT01", 1),
  plg("PIUT05", 5),
  plg("21.7", 3),
  plg("TUNAI01", 4),
  plg("TUNAI02", 4, { terminHari: 7, diaturOleh: "staf@contoh.test", diaturAt: "2026-11-01 09:00" }),
  plg("LAIN02", 2),
  plg("YATIM/01", null, { diMaster: false, namaPelanggan: null, terminHari: 14, diaturAt: "2026-10-01 09:00" }),
];
const kodeTampil = (html: string): string[] => [...html.matchAll(/data-termin-baris="([^"]+)"/g)].map((m) => m[1]!).sort();

const buka = async (query: Record<string, string> = {}) => renderToStaticMarkup(
  await AturTerminPage({ params: Promise.resolve({ code: unit.code }), searchParams: Promise.resolve(query) }),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDataScope.mockResolvedValue({ role: "keuangan", email: "staf@contoh.test", units: [unit], requireUnit: () => unit });
  mocks.getTerminUnit.mockResolvedValue({ terminHari: 30, diaturOleh: "staf@contoh.test", diaturAt: "2026-11-01 09:00" });
  mocks.getPelangganUntukTermin.mockResolvedValue(MASTER);
  mocks.getTagihanRingkasanUnit.mockResolvedValue({
    tersedia: true, kesiapan: CONTOH_KESIAPAN, fakturBergantungTermin: 12, terpotong: false,
    ubin: {
      lewatJatuhTempo: { jumlah: 4, sisa: 4_000_000 },
      belumJatuhTempo: { jumlah: 5, sisa: 5_000_000 },
      terminBelumDiatur: { jumlah: 3, sisa: 3_000_000 },
    },
  });
});

describe("S4 — /keuangan/unit/[code]/tagihan/termin", () => {
  it("🔴 bawaan: hanya pelanggan piutang (kelas 1/5 atau kode bertitik) + SETIAP pengecualian; kelas tunai tanpa pengecualian tak tampil", async () => {
    const h = await buka();
    expect(kodeTampil(h)).toEqual(["21.7", "PIUT01", "PIUT05", "TUNAI02", "YATIM/01"]);
    expect(h).toContain('data-termin-cakupan="piutang"');
    expect(h).toContain("5 dari 7 pelanggan");
    expect(h).toContain('<a href="/keuangan/unit/6400001/tagihan/termin?semua=1">Tampilkan semua pelanggan</a>');
  });

  it("?semua=1: seluruh master, dan tautan kembali ke daftar pelanggan piutang; pencarian ikut di kedua arah", async () => {
    const h = await buka({ semua: "1", q: "tunai" });
    expect(h).toContain('data-termin-cakupan="semua"');
    expect(h).toContain('<a href="/keuangan/unit/6400001/tagihan/termin?q=tunai">Hanya pelanggan piutang</a>');
    expect(kodeTampil(h)).toEqual(["TUNAI01", "TUNAI02"]);
    expect(kodeTampil(await buka({ semua: "1" }))).toEqual(MASTER.map((p) => p.kodePelanggan).sort());
    expect(await buka({ q: "tunai" })).toContain('href="/keuangan/unit/6400001/tagihan/termin?semua=1&amp;q=tunai"');
    // Nilai lain bukan sakelar.
    expect(kodeTampil(await buka({ semua: "ya" }))).toEqual(["21.7", "PIUT01", "PIUT05", "TUNAI02", "YATIM/01"]);
  });

  it("🔴 catatan 'N faktur bergantung termin' diambil TANPA memindai buku piutang (tanpaBelumDitagihkan)", async () => {
    const h = await buka();
    expect(mocks.getTagihanRingkasanUnit).toHaveBeenCalledTimes(1);
    expect(mocks.getTagihanRingkasanUnit).toHaveBeenCalledWith(7, undefined, { tanpaBelumDitagihkan: true });
    expect(h).toContain("12 faktur terbuka saat ini bergantung pada");
    expect(h).toContain("3 di antaranya masih");
  });

  it("unit tanpa siklus tagihan lengkap: termin tetap bisa diatur, catatannya berkata belum tersedia", async () => {
    mocks.getTagihanRingkasanUnit.mockResolvedValue({ tersedia: false });
    const h = await buka();
    expect(h).toContain("data-termin-belum-tersedia");
    expect(kodeTampil(h)).toEqual(["21.7", "PIUT01", "PIUT05", "TUNAI02", "YATIM/01"]);
  });
});
