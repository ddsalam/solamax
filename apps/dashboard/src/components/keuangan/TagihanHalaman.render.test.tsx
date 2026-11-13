import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaldoSnapshot } from "@/lib/saldo-snapshot";
import type { ScopedUnitId } from "@/lib/scope-rule";
import { CONTOH, CONTOH_KESIAPAN, contohCocok, contohDaftar, contohPembayaran, contohUbin } from "./TagihanContoh";

/**
 * Tiga HALAMAN tagihan (S1/S3, S2, S6) dirender dari komponen server-nya dengan
 * scope, wewenang dan kueri TIRUAN: gerbang 404, tampilan bawaan, dan kueri
 * mana yang dipanggil dengan apa. Semua nilai ilustratif.
 */
const mocks = vi.hoisted(() => ({
  getDataScope: vi.fn(),
  canView: vi.fn(),
  getTagihanDaftar: vi.fn(),
  getBelumDitagihkan: vi.fn(),
  getTagihanFaktur: vi.fn(),
  getTanggalSaldoPelanggan: vi.fn(),
  getTagihanPelanggan: vi.fn(),
  getSaldoSnapshot: vi.fn(),
  filters: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/UnitDateFilters", () => ({ UnitDateFilters: mocks.filters }));
vi.mock("@/lib/scope", () => ({ getDataScope: mocks.getDataScope }));
vi.mock("@/lib/keuangan-wewenang", () => ({ canViewLaporanKeuangan: mocks.canView }));
vi.mock("@/lib/periods", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  todayWib: () => "2026-11-13",
}));
vi.mock("@/lib/tagihan-queries", () => ({
  TAGIHAN_BELUM_TERSEDIA: "Data tagihan belum tersedia untuk SPBU ini",
  BATAS_BARIS_TAGIHAN: 5000,
  getTagihanDaftar: mocks.getTagihanDaftar,
  getBelumDitagihkan: mocks.getBelumDitagihkan,
  getTagihanFaktur: mocks.getTagihanFaktur,
  getTanggalSaldoPelanggan: mocks.getTanggalSaldoPelanggan,
  getTagihanPelanggan: mocks.getTagihanPelanggan,
}));
vi.mock("@/lib/saldo-snapshot", () => ({ getSaldoSnapshot: mocks.getSaldoSnapshot }));
vi.mock("@/lib/saldo-cache", () => ({ getCachedSaldoFreshness: async () => undefined }));

const { default: TagihanPage } = await import("@/app/(app)/keuangan/unit/[code]/tagihan/page");
const { default: TagihanFakturPage } = await import("@/app/(app)/keuangan/unit/[code]/tagihan/faktur/[kode]/page");
const { default: PelangganPage } = await import(
  "@/app/(app)/keuangan/unit/[code]/piutang/[date]/pelanggan/[...customerCode]/page"
);

const unit = { unit_id: 7 as ScopedUnitId, code: "6400001", name: "SPBU Contoh" };
const scope = (o: Record<string, unknown> = {}) => ({
  role: "keuangan",
  email: "keuangan@example.com",
  units: [unit],
  requireUnit: vi.fn(() => unit),
  ...o,
});
const diLuarScope = () => scope({
  requireUnit: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
});

const semua = [CONTOH.lewat(), CONTOH.sebagianLewat(), CONTOH.terminBelumDiatur()];
const dasar = { tersedia: true as const, kesiapan: CONTOH_KESIAPAN, fakturBergantungTermin: 0, terpotong: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canView.mockReturnValue(true);
  mocks.getDataScope.mockResolvedValue(scope());
});

describe("S1/S3 — /keuangan/unit/[code]/tagihan", () => {
  const buka = async (query: Record<string, string> = {}) => renderToStaticMarkup(
    await TagihanPage({ params: Promise.resolve({ code: unit.code }), searchParams: Promise.resolve(query) }),
  );

  beforeEach(() => {
    mocks.getTagihanDaftar.mockResolvedValue(contohDaftar(semua));
    // Seperti kuerinya: dokumen ikut dipulangkan HANYA bila diminta, dari panggilan yang sama.
    mocks.getBelumDitagihkan.mockImplementation(async (_unit: unknown, input: { dokumen?: unknown }) => ({
      ...dasar, ubin: contohUbin(semua), cari: "", saldoPerTanggal: "2026-11-12", saldoSedangDiperbarui: false,
      kelompok: [{ customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", jumlahDokumen: 1, total: 750_000,
        tanggalTertua: "2026-11-03", cocokSaldo: contohCocok() }],
      dokumen: input.dokumen === undefined ? null : {
        terpotong: false,
        dokumen: [{ customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "JP-000101",
          tanggal: "2026-11-03", jumlah: 750_000, keterangan: null }],
      },
    }));
  });

  it("🔴 tanpa parameter: tampilan bawaan Perlu tindakan, halaman 1, status dihitung per hari ini", async () => {
    const h = await buka();
    expect(mocks.getTagihanDaftar).toHaveBeenCalledWith(7, {
      filter: "perlu_tindakan",
      cari: "",
      halaman: 1,
      periodeLunas: { from: "2026-10-01", to: "2026-11-30" },
      hariIni: "2026-11-13",
    });
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
    expect(h).toContain("Tagihan pelanggan");
    expect(h).toMatch(/aria-current="page"[^>]*>Perlu tindakan</);
    expect(h).toContain("TG-0001");
  });

  it("nilai URL tak dikenal dinormalkan ke bawaan; yang sah diteruskan", async () => {
    await buka({ filter: "rahasia", page: "abc" });
    expect(mocks.getTagihanDaftar).toHaveBeenLastCalledWith(7, expect.objectContaining({ filter: "perlu_tindakan", halaman: 1 }));
    await buka({ filter: "lunas", q: " mitra ", page: "3", from: "2026-09-01", to: "2026-09-30" });
    expect(mocks.getTagihanDaftar).toHaveBeenLastCalledWith(7, {
      filter: "lunas", cari: "mitra", halaman: 3,
      periodeLunas: { from: "2026-09-01", to: "2026-09-30" }, hariIni: "2026-11-13",
    });
  });

  it("memasang pemilih unit tanpa dimensi tanggal", async () => {
    await buka();
    const props = mocks.filters.mock.calls[0]![0];
    expect(props).toMatchObject({ code: "6400001", segment: "keuangan-tagihan" });
    expect(props).not.toHaveProperty("date");
    expect(props).not.toHaveProperty("dimensiUnit");
  });

  it("🔴 belum_ditagihkan: SATU panggilan kueri S3, dibuka atau tidak; dokumen hanya tampil untuk kelompok yang dibuka DAN ada di daftar", async () => {
    const tertutup = await buka({ filter: "belum_ditagihkan" });
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledTimes(1);
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledWith(7, { cari: "", hariIni: "2026-11-13" });
    expect(mocks.getTagihanDaftar).not.toHaveBeenCalled();
    expect(tertutup).not.toContain("JP-000101");

    // Dibuka: dokumennya diminta di panggilan yang SAMA — buku piutang tak dibaca dua kali.
    mocks.getBelumDitagihkan.mockClear();
    const terbuka = await buka({ filter: "belum_ditagihkan", buka: "P-001" });
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledTimes(1);
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledWith(7, {
      cari: "", hariIni: "2026-11-13", dokumen: { kodePelanggan: "P-001" },
    });
    expect(terbuka).toContain("JP-000101");

    // `buka` yang tak cocok dengan kelompok mana pun: dokumennya tak ditampilkan.
    mocks.getBelumDitagihkan.mockClear();
    const asing = await buka({ filter: "belum_ditagihkan", buka: "P-TIDAK-ADA" });
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledTimes(1);
    expect(asing).not.toContain("JP-000101");
  });

  it.each<Record<string, string>>([{}, { filter: "belum_ditagihkan" }])("🔴 unit tanpa siklus lengkap (%o) → keadaan belum tersedia", async (query) => {
    mocks.getTagihanDaftar.mockResolvedValue({ tersedia: false });
    mocks.getBelumDitagihkan.mockResolvedValue({ tersedia: false });
    const h = await buka(query);
    expect(h).toContain("Data tagihan belum tersedia untuk SPBU ini");
    expect(h).not.toContain("<table");
  });

  it("🔴 tanpa wewenang baca keuangan → 404 sebelum satu kueri pun", async () => {
    mocks.canView.mockReturnValue(false);
    await expect(buka()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.canView).toHaveBeenCalledWith({ role: "keuangan", email: "keuangan@example.com" });
    expect(mocks.getTagihanDaftar).not.toHaveBeenCalled();
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
  });

  it("🔴 unit di luar scope → 404 sebelum wewenang maupun kueri", async () => {
    mocks.getDataScope.mockResolvedValue(diLuarScope());
    await expect(buka()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.canView).not.toHaveBeenCalled();
    expect(mocks.getTagihanDaftar).not.toHaveBeenCalled();
  });
});

describe("S2 — /keuangan/unit/[code]/tagihan/faktur/[kode]", () => {
  const baris = CONTOH.sebagianLewat();
  const rinci = {
    kesiapan: CONTOH_KESIAPAN, faktur: baris.faktur, namaPelanggan: baris.namaPelanggan, tanggalFakturKosong: false,
    status: baris.status, alasanBatal: null, keterangan: null, jenisTagihan: 1, nilaiPokok: 10_000_000, biayaAdmin: 0,
    dokumen: [{ kodeDokumen: "JP-000201", tanggal: "2026-10-20", jumlah: 10_000_000 }],
    totalDokumen: 10_000_000, dokumenTanpaBuku: 0, pembayaran: [contohPembayaran({ kode: "BY-0001" })],
    pembayaranTerpotong: false,
  };
  const buka = async (kode: string) => renderToStaticMarkup(
    await TagihanFakturPage({ params: Promise.resolve({ code: unit.code, kode }) }),
  );

  beforeEach(() => {
    mocks.getTagihanFaktur.mockResolvedValue(rinci);
    mocks.getTanggalSaldoPelanggan.mockResolvedValue("2026-11-12");
  });

  it("merender rincian; halaman pelanggan ditaut pada tanggal snapshot Saldo pelanggan terbit terakhir", async () => {
    const h = await buka("TG-0002");
    expect(mocks.getTagihanFaktur).toHaveBeenCalledWith(7, "TG-0002", "2026-11-13");
    // Keberadaan halaman pelanggan ditanyakan untuk pelanggan FAKTUR ini, di unit pemanggil.
    expect(mocks.getTanggalSaldoPelanggan).toHaveBeenCalledWith(7, "P-002");
    expect(h).toContain("Faktur TG-0002");
    expect(h).toContain('href="/keuangan/unit/6400001/piutang/2026-11-12/pelanggan/P-002"');
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan">← Kembali ke daftar</a>');
    expect(mocks.filters.mock.calls[0]![0]).toMatchObject({ code: "6400001", segment: "keuangan-tagihan" });
  });

  it("🔴 pelanggan tak ada di snapshot terbit terakhir (atau belum ada snapshot) → TANPA tautan halaman pelanggan, nama sebagai teks", async () => {
    mocks.getTanggalSaldoPelanggan.mockResolvedValue(null);
    const h = await buka("TG-0002");
    expect(h).not.toContain("/piutang/");
    expect(h).not.toContain("Halaman pelanggan");
    expect(h).toContain("<span>CV Mitra Contoh</span>");
    expect(h).toContain("Faktur TG-0002");
  });

  it("🔴 faktur tanpa kode pelanggan → tanpa tautan (kueri keberadaan memulangkan null untuk kode kosong)", async () => {
    mocks.getTagihanFaktur.mockResolvedValue({ ...rinci, faktur: { ...rinci.faktur, customerCode: "" } });
    mocks.getTanggalSaldoPelanggan.mockImplementation(async (_u: unknown, kode: string) => (kode.trim() === "" ? null : "2026-11-12"));
    const h = await buka("TG-0002");
    expect(mocks.getTanggalSaldoPelanggan).toHaveBeenCalledWith(7, "");
    expect(h).not.toContain("/piutang/");
    expect(h).not.toContain("Halaman pelanggan");
  });

  it("kode ter-encode di-decode sebelum dicari", async () => {
    await buka("TG%2F0002");
    expect(mocks.getTagihanFaktur).toHaveBeenCalledWith(7, "TG/0002", "2026-11-13");
  });

  it.each(["%20", "KODE-LEBIH-DARI-LIMA-BELAS"])("🔴 kode tak sah (%s) → 404 tanpa menyentuh scope atau data", async (kode) => {
    await expect(buka(kode)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getDataScope).not.toHaveBeenCalled();
    expect(mocks.getTagihanFaktur).not.toHaveBeenCalled();
  });

  it("🔴 faktur tak dikenal — atau milik unit lain, yang bagi kueri ber-scope sama saja — → 404", async () => {
    mocks.getTagihanFaktur.mockResolvedValue(null);
    await expect(buka("TG-9999")).rejects.toThrow("NEXT_NOT_FOUND");
    // Kueri hanya pernah menerima unit dari scope pemanggil, bukan dari URL.
    expect(mocks.getTagihanFaktur).toHaveBeenCalledWith(7, "TG-9999", "2026-11-13");
  });

  it("🔴 tanpa wewenang baca / unit di luar scope → 404 sebelum faktur dibaca", async () => {
    mocks.canView.mockReturnValue(false);
    await expect(buka("TG-0002")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getTagihanFaktur).not.toHaveBeenCalled();

    mocks.canView.mockReturnValue(true);
    mocks.getDataScope.mockResolvedValue(diLuarScope());
    await expect(buka("TG-0002")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getTagihanFaktur).not.toHaveBeenCalled();
  });
});

describe("S6 — halaman pelanggan Saldo pelanggan", () => {
  const nol = { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 };
  const snapshot: SaldoSnapshot = {
    status: "ready",
    asOfDate: "2026-11-12",
    metadata: {
      generationId: "generation-1", rowCount: 1, formulaVersion: "saldo-pelanggan-v2",
      computedAt: "2026-11-12T03:01:00Z", sourceCycleId: "cycle-1", sourceCompletedAt: "2026-11-12T03:00:00Z",
      pendingReplacement: false, staleInvalidFrom: null,
      debetTotals: { awal: nol, akhir: { ...nol, piutangLokal: 10 } },
      kreditTotals: { awal: nol, akhir: nol },
      totals: { awal: nol, akhir: { ...nol, piutangLokal: 10 } },
    },
    rows: [{
      customerCode: "P-001 ", customerName: "PT Pelanggan Contoh",
      awalPiutangLokalDebet: 0, awalPiutangLokalKredit: 0, akhirPiutangLokalDebet: 10, akhirPiutangLokalKredit: 0,
      awalPiutangOnlineDebet: 0, awalPiutangOnlineKredit: 0, akhirPiutangOnlineDebet: 0, akhirPiutangOnlineKredit: 0,
      awalHutangLokalDebet: 0, awalHutangLokalKredit: 0, akhirHutangLokalDebet: 0, akhirHutangLokalKredit: 0,
      awalPiutangLokal: 0, akhirPiutangLokal: 10, awalPiutangOnline: 0, akhirPiutangOnline: 0,
      awalHutangLokal: 0, akhirHutangLokal: 0,
    }],
    hasOnlineCustomer: false,
  };
  const buka = async (customerCode = ["P-001"]) => renderToStaticMarkup(
    await PelangganPage({ params: Promise.resolve({ code: unit.code, date: "2026-11-12", customerCode }) }),
  );

  beforeEach(() => {
    mocks.getSaldoSnapshot.mockResolvedValue(snapshot);
    mocks.getTagihanPelanggan.mockResolvedValue({
      tersedia: true, kesiapan: CONTOH_KESIAPAN, customerCode: "P-001",
      faktur: [CONTOH.lewat()], pembayaran: [contohPembayaran({ kode: "BY-0001", kodeFaktur: "TG-0001" })],
      belumDitagihkan: { jumlahDokumen: 0, total: 0, tanggalTertua: null },
      cocokSaldo: contohCocok(), terpotong: false,
    });
  });

  it("🔴 kartu pengganti Fase 1 hilang; seksi Tagihan dan Pembayaran tampil, ringkasan saldo tetap ada", async () => {
    const h = await buka();
    expect(h).not.toContain("Aktivitas pelanggan");
    expect(h).not.toContain("Ruang ini disiapkan");
    expect(h).not.toContain("fase berikutnya");
    expect(h).toContain('<h2 id="tagihan-pelanggan-judul">Tagihan</h2>');
    expect(h).toContain('<h2 id="pembayaran-pelanggan-judul">Pembayaran</h2>');
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan/faktur/TG-0001"');
    expect(h).toContain("BY-0001");
    // Yang lama tetap bekerja.
    expect(h).toContain("PT Pelanggan Contoh");
    expect(h).toContain("Ringkasan Piutang Lokal");
    expect(h).toContain("← Kembali ke daftar");
    expect(mocks.getTagihanPelanggan).toHaveBeenCalledWith(7, "P-001 ");
  });

  it("sumber halaman tidak lagi memuat teks atau kelas kartu pengganti", () => {
    const sumber = readFileSync(resolve(
      process.cwd(), "src/app/(app)/keuangan/unit/[code]/piutang/[date]/pelanggan/[...customerCode]/page.tsx",
    ), "utf8");
    expect(sumber).not.toMatch(/Aktivitas pelanggan|Ruang ini disiapkan|b6-piutang-activity/);
    expect(sumber).toContain("<TagihanPelangganSeksi");
  });

  it("unit tanpa siklus tagihan lengkap → seksi berisi keadaan belum tersedia, saldo tetap tampil", async () => {
    mocks.getTagihanPelanggan.mockResolvedValue({ tersedia: false });
    const h = await buka();
    expect(h).toContain("Data tagihan belum tersedia untuk SPBU ini");
    expect(h).toContain("Ringkasan Piutang Lokal");
    expect(h).not.toContain("tagihan-pelanggan-judul");
  });

  it("🔴 pelanggan yang tak ada di snapshot unit ini → 404, tagihan tidak dibaca", async () => {
    await expect(buka(["P-999"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getTagihanPelanggan).not.toHaveBeenCalled();
  });

  it("🔴 tanpa wewenang baca → 404 sebelum snapshot maupun tagihan dibaca", async () => {
    mocks.canView.mockReturnValue(false);
    await expect(buka()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getSaldoSnapshot).not.toHaveBeenCalled();
    expect(mocks.getTagihanPelanggan).not.toHaveBeenCalled();
  });

  it("snapshot belum siap: halaman belum-siap yang lama, tagihan tidak dibaca", async () => {
    mocks.getSaldoSnapshot.mockResolvedValue({ status: "not_ready", asOfDate: "2026-11-12", reason: "no_published_snapshot" });
    const h = await buka();
    expect(h).not.toContain("tagihan-pelanggan-judul");
    expect(mocks.getTagihanPelanggan).not.toHaveBeenCalled();
  });
});
