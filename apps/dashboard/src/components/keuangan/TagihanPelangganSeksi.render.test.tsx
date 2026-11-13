import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compareTagihanRows } from "@/lib/tagihan-model";
import { TAGIHAN_BELUM_TERSEDIA, type TagihanPelanggan } from "@/lib/tagihan-queries";
import { CONTOH, CONTOH_KESIAPAN, CONTOH_UNIT, contohBaris, contohCocok, contohPembayaran } from "./TagihanContoh";
import { TagihanPelangganSeksi } from "./TagihanPelangganSeksi";

// Komponen membaca konstanta dari `tagihan-queries`, yang memuat `db` (pool
// dibuat saat impor). Render statis tak pernah menyentuh basis data.
vi.mock("@/lib/db", () => ({ qScoped: vi.fn() }));

/** Semua nilai ilustratif. */
const pelanggan = (o: Partial<TagihanPelanggan> = {}): TagihanPelanggan => ({
  tersedia: true,
  kesiapan: CONTOH_KESIAPAN,
  customerCode: "P-001",
  faktur: [CONTOH.lewat(), contohBaris({ kode: "TG-0010", dibayar: 4_000_000 }), CONTOH.lunas()].sort(compareTagihanRows),
  pembayaran: [
    contohPembayaran({ kode: "BY-0003", kodeFaktur: "TG-0005", tanggal: "2026-11-07", jumlah: 10_000_000 }),
    contohPembayaran({ kode: "BY-0002", kodeFaktur: "TG-0010", tanggal: "2026-11-06", jumlah: 2_500_000, batal: true, alasanBatal: "Dobel input" }),
    contohPembayaran({ kode: "BY-0001", kodeFaktur: "TG-0010", jumlah: 4_000_000 }),
  ],
  belumDitagihkan: { jumlahDokumen: 2, total: 1_250_000, tanggalTertua: "2026-11-03" },
  cocokSaldo: contohCocok(),
  saldoSedangDiperbarui: false,
  terpotong: false,
  pembayaranTerpotong: false,
  ...o,
});

const html = (data: Parameters<typeof TagihanPelangganSeksi>[0]["data"]): string =>
  renderToStaticMarkup(<TagihanPelangganSeksi unit={CONTOH_UNIT} data={data} />);

describe("S6 — Tagihan & Pembayaran di halaman pelanggan", () => {
  it("dua seksi: Tagihan dan Pembayaran", () => {
    const h = html(pelanggan());
    expect(h).toContain('<h2 id="tagihan-pelanggan-judul">Tagihan</h2>');
    expect(h).toContain('<h2 id="pembayaran-pelanggan-judul">Pembayaran</h2>');
    expect(h.match(/<table/g)).toHaveLength(2);
  });

  it("Tagihan: kolom S1 tanpa kolom pelanggan, faktur lunas ikut, baris menaut ke rincian faktur", () => {
    const h = html(pelanggan());
    const seksi = h.slice(0, h.indexOf("pembayaran-pelanggan-judul"));
    for (const kolom of ["No. faktur", "Tgl faktur", "Jatuh tempo", "Nilai", "Dibayar", "Sisa", "Status"]) {
      expect(seksi).toContain(`>${kolom}</th>`);
    }
    expect(seksi).not.toContain("Pelanggan · no. faktur");
    expect(seksi).not.toContain("PT Pelanggan Contoh");
    expect(seksi).toContain("3 faktur, termasuk yang lunas");
    expect(seksi).toContain('href="/keuangan/unit/6400001/tagihan/faktur/TG-0010"');
    expect(seksi).toContain('class="status-pill success">Lunas<');
    expect(seksi).toContain('class="status-pill warning">Sebagian<');
    // Seksi ini keadaan terbaru, bukan posisi pada tanggal saldo halaman induk.
    expect(seksi).toContain("bukan posisi pada tanggal saldo di atas");
    expect(seksi).toContain("Data EasyMax terakhir masuk");
  });

  it("belum ditagihkan dan cocok-silang R20 pelanggan ini", () => {
    const h = html(pelanggan());
    expect(h).toContain("Belum ditagihkan: 2 dokumen · Rp 1.250.000 · tertua 3 Nov 2026");
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan?filter=belum_ditagihkan&amp;buka=P-001">Lihat dokumennya</a>');
    expect(h).toMatch(/<dt>Selisih<\/dt><dd class="num w600">Rp 250\.000<\/dd>/);
  });

  it("🔴 Pembayaran lintas faktur: yang batal dicoret + alasannya, dan tidak ikut total", () => {
    const h = html(pelanggan());
    const seksi = h.slice(h.indexOf("pembayaran-pelanggan-judul"));
    expect(seksi).toContain(">Faktur</th>");
    expect(seksi).toContain('href="/keuangan/unit/6400001/tagihan/faktur/TG-0005">TG-0005</a>');
    expect(seksi).toMatch(/<tr class="tagihan-batal"><td><span class="tagihan-coret mono">BY-0002<\/span>/);
    expect(seksi).toContain("Batal — Dobel input");
    expect(seksi.match(/class="tagihan-batal"/g)).toHaveLength(1);
    // 10 jt + 4 jt; 2,5 jt yang batal tidak dihitung.
    expect(seksi).toMatch(/data-tagihan-total-bayar="true">Rp 14\.000\.000</);
    expect(seksi).toContain("3 pembayaran tercatat di semua faktur · Rp 14.000.000 dihitung");
  });

  it("keadaan kosong per seksi", () => {
    const h = html(pelanggan({
      faktur: [], pembayaran: [],
      belumDitagihkan: { jumlahDokumen: 0, total: 0, tanggalTertua: null },
    }));
    expect(h).toContain("Pelanggan ini belum punya faktur.");
    expect(h).toContain("Belum ada pembayaran tercatat untuk pelanggan ini.");
    expect(h).not.toContain("<table");
    expect(h).not.toContain("Lihat dokumennya");
  });

  it("terpotong: dikatakan di seksi Tagihan", () => {
    expect(html(pelanggan({ terpotong: true }))).toContain("daftar ini tidak lengkap");
    expect(html(pelanggan())).not.toContain("daftar ini tidak lengkap");
  });

  it("🔴 pembayaran terpotong: dikatakan di seksi Pembayaran, terpisah dari terpotongnya faktur", () => {
    const h = html(pelanggan({ pembayaranTerpotong: true }));
    const seksi = h.slice(h.indexOf('id="pembayaran-pelanggan-judul"'));
    expect(seksi).toContain("data-tagihan-bayar-terpotong");
    expect(seksi).toContain("Hanya 5.000 pembayaran terbaru yang ditampilkan; daftar dan total pembayaran ini tidak lengkap.");
    expect(h).not.toContain("faktur pertama yang ditampilkan");
    expect(html(pelanggan())).not.toContain("data-tagihan-bayar-terpotong");
  });

  it("saldo pembanding sedang diperbarui → catatan di atas baris cocok-silang; tanpa itu tak ada", () => {
    const h = html(pelanggan({ saldoSedangDiperbarui: true }));
    expect(h).toContain("data-tagihan-saldo-diperbarui");
    expect(h).toContain("Saldo pelanggan per 12 Nov 2026 sedang diperbarui; saldo piutang dan selisih di bawah bisa berubah.");
    expect(h.indexOf("data-tagihan-saldo-diperbarui")).toBeLessThan(h.indexOf('class="tagihan-cocok"'));
    expect(html(pelanggan())).not.toContain("sedang diperbarui");
  });

  it("🔴 belum tersedia: teks KTD11, bukan dua seksi kosong", () => {
    const h = html({ tersedia: false });
    expect(h).toContain(TAGIHAN_BELUM_TERSEDIA);
    expect(h).not.toContain("belum punya faktur");
    expect(h).not.toContain("<table");
  });
});
