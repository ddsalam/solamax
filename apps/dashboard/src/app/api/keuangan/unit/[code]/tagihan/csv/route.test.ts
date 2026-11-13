import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "@/lib/scope-rule";
import { compareTagihanRows } from "@/lib/tagihan-model";
import { CONTOH, CONTOH_KESIAPAN, contohCocok, contohUbin } from "@/components/keuangan/TagihanContoh";

/**
 * Perilaku rute ekspor CSV Tagihan pelanggan — pola `piutang-export-routes.test.ts`:
 * masukan tak sah ditolak SEBELUM menyentuh scope/data, unit di luar scope dan
 * peran tanpa wewenang baca ditolak SEBELUM data dibaca. Semua nilai ilustratif.
 */
const mocks = vi.hoisted(() => ({
  getDataScope: vi.fn(),
  canView: vi.fn(),
  getTagihanEkspor: vi.fn(),
  getBelumDitagihkan: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/scope", () => ({ getDataScope: mocks.getDataScope }));
vi.mock("@/lib/keuangan-wewenang", () => ({ canViewLaporanKeuangan: mocks.canView }));
vi.mock("@/lib/config", () => ({ ptLabelForUnits: () => "PT Contoh" }));
vi.mock("@/lib/periods", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  todayWib: () => "2026-11-13",
}));
vi.mock("@/lib/tagihan-queries", () => ({
  TAGIHAN_BELUM_TERSEDIA: "Data tagihan belum tersedia untuk SPBU ini",
  getTagihanEkspor: mocks.getTagihanEkspor,
  getBelumDitagihkan: mocks.getBelumDitagihkan,
}));

const { GET } = await import("./route");

const unit = { unit_id: 7 as ScopedUnitId, code: "6400001", name: "SPBU Contoh" };
const context = () => ({ params: Promise.resolve({ code: unit.code }) });
const minta = (query = "") => GET(new Request(`http://test/export${query}`), context());
const dasar = { tersedia: true as const, kesiapan: CONTOH_KESIAPAN, fakturBergantungTermin: 0, terpotong: false };

/** Nomor di kolom ke-5 (No. faktur / No. dokumen) dari baris data berkode unit. */
const kolomKelima = (csv: string): string[] =>
  csv.split("\r\n").filter((baris) => baris.startsWith("6400001,")).map((baris) => baris.split(",")[4]!);

describe("rute ekspor CSV tagihan", () => {
  const lewat = [CONTOH.bedaEasymax(), CONTOH.lewat(), CONTOH.sebagianLewat()].sort(compareTagihanRows);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canView.mockReturnValue(true);
    mocks.getDataScope.mockResolvedValue({
      role: "keuangan",
      email: "keuangan@example.com",
      requireUnit: vi.fn(() => unit),
    });
    mocks.getTagihanEkspor.mockResolvedValue({
      ...dasar, ubin: contohUbin(lewat), filter: "lewat_jatuh_tempo", cari: "", periodeLunas: null, baris: lewat,
    });
    mocks.getBelumDitagihkan.mockResolvedValue({
      ...dasar, ubin: contohUbin([]), cari: "contoh", saldoPerTanggal: null, saldoSedangDiperbarui: false,
      kelompok: [{ customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", jumlahDokumen: 2, total: 1_250_000,
        tanggalTertua: "2026-11-03", cocokSaldo: contohCocok() }],
      // Dokumen SELURUH unit, dari kueri yang sama dengan kelompoknya.
      dokumen: {
        terpotong: false,
        dokumen: [
          { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "JP-000101", tanggal: "2026-11-03", jumlah: 750_000, keterangan: null },
          { customerCode: "P-009", namaPelanggan: "Pelanggan Lain", kodeDokumen: "JP-000150", tanggal: "2026-11-04", jumlah: 300_000, keterangan: null },
          { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "UV-000007", tanggal: "2026-11-08", jumlah: 500_000, keterangan: null },
        ],
      },
    });
  });

  it.each([
    ["saringan tak dikenal", "?filter=rahasia"],
    ["halaman bukan angka", "?page=dua"],
    ["periode tak sah", "?filter=lunas&from=2026-13-01&to=2026-11-30"],
    ["periode terbalik", "?filter=lunas&from=2026-11-30&to=2026-11-01"],
  ])("🔴 %s → 400 sebelum scope maupun data disentuh", async (_nama, query) => {
    const response = await minta(query);
    expect(response.status).toBe(400);
    expect(mocks.getDataScope).not.toHaveBeenCalled();
    expect(mocks.getTagihanEkspor).not.toHaveBeenCalled();
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
  });

  it("🔴 baris CSV = baris saringan aktif, dan kueri menerima saringan + pencarian yang sama dengan layar", async () => {
    const response = await minta("?filter=lewat_jatuh_tempo&q=contoh");
    expect(response.status).toBe(200);
    expect(mocks.getTagihanEkspor).toHaveBeenCalledWith(7, {
      filter: "lewat_jatuh_tempo",
      cari: "contoh",
      periodeLunas: { from: "2026-10-01", to: "2026-11-30" },
      hariIni: "2026-11-13",
    });
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
    const csv = await response.text();
    expect(kolomKelima(csv)).toEqual(lewat.map((b) => b.faktur.kode));
    expect(csv).toContain("Saringan,Lewat jatuh tempo");
  });

  it("tanpa parameter = tampilan bawaan Perlu tindakan", async () => {
    await minta();
    expect(mocks.getTagihanEkspor).toHaveBeenCalledWith(7, expect.objectContaining({ filter: "perlu_tindakan", cari: "" }));
  });

  it("Lunas membawa periode dari URL, dan nama berkasnya memuat periode itu", async () => {
    const response = await minta("?filter=lunas&from=2026-09-01&to=2026-09-30");
    expect(mocks.getTagihanEkspor).toHaveBeenCalledWith(7, expect.objectContaining({
      filter: "lunas", periodeLunas: { from: "2026-09-01", to: "2026-09-30" },
    }));
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Tagihan-Pelanggan-Lunas_SPBU-6400001_2026-09-01-sd-2026-09-30_2026-11-13.csv"',
    );
  });

  it("🔴 Belum ditagihkan mengekspor DOKUMEN, hanya milik pelanggan yang lolos pencarian layar", async () => {
    const response = await minta("?filter=belum_ditagihkan&q=contoh");
    expect(response.status).toBe(200);
    expect(mocks.getTagihanEkspor).not.toHaveBeenCalled();
    // SATU panggilan: kelompok + seluruh dokumen dari kueri yang sama (buku piutang dipindai sekali).
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledTimes(1);
    expect(mocks.getBelumDitagihkan).toHaveBeenCalledWith(7, { cari: "contoh", hariIni: "2026-11-13", dokumen: "semua" });
    const csv = await response.text();
    // P-009 tidak ada di kelompok hasil pencarian → dokumennya tidak ikut.
    expect(kolomKelima(csv)).toEqual(["JP-000101", "UV-000007"]);
    expect(csv).toContain("Saringan,Belum ditagihkan");
  });

  it("lampiran no-store bertipe CSV", async () => {
    const response = await minta("?filter=sebagian");
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Tagihan-Pelanggan-Sebagian_SPBU-6400001_2026-11-13_2026-11-13.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["?filter=perlu_tindakan", "?filter=belum_ditagihkan"])(
    "🔴 unit tanpa siklus tagihan lengkap (%s) → 409 tanpa angka, bukan CSV kosong",
    async (query) => {
      mocks.getTagihanEkspor.mockResolvedValue({ tersedia: false });
      mocks.getBelumDitagihkan.mockResolvedValue({ tersedia: false });
      const response = await minta(query);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        status: "belum tersedia",
        reason: "Data tagihan belum tersedia untuk SPBU ini",
      });
    },
  );

  it("🔴 peran tanpa wewenang baca keuangan → 404 sebelum data dibaca", async () => {
    mocks.canView.mockReturnValue(false);
    await expect(minta()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.canView).toHaveBeenCalledWith({ role: "keuangan", email: "keuangan@example.com" });
    expect(mocks.getTagihanEkspor).not.toHaveBeenCalled();
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
  });

  it("🔴 unit di luar scope → 404 sebelum wewenang maupun data diperiksa", async () => {
    mocks.getDataScope.mockResolvedValue({
      role: "keuangan",
      email: "keuangan@example.com",
      requireUnit: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    });
    await expect(minta("?filter=belum_ditagihkan")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.canView).not.toHaveBeenCalled();
    expect(mocks.getBelumDitagihkan).not.toHaveBeenCalled();
  });
});
