import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deriveTagihanStatus } from "@/lib/tagihan-model";
import type { TagihanFakturRinci } from "@/lib/tagihan-queries";
import { CONTOH, CONTOH_HARI_INI, CONTOH_KESIAPAN, CONTOH_UNIT, contohPembayaran } from "./TagihanContoh";
import { TagihanFakturView } from "./TagihanFakturView";

// Komponen membaca konstanta dari `tagihan-queries`, yang memuat `db` (pool
// dibuat saat impor). Render statis tak pernah menyentuh basis data.
vi.mock("@/lib/db", () => ({ qScoped: vi.fn() }));

/** Semua nilai ilustratif. */
function rinci(
  baris: ReturnType<(typeof CONTOH)[keyof typeof CONTOH]>,
  o: Partial<TagihanFakturRinci> = {},
): TagihanFakturRinci {
  return {
    kesiapan: CONTOH_KESIAPAN,
    faktur: baris.faktur,
    namaPelanggan: baris.namaPelanggan,
    tanggalFakturKosong: false,
    status: baris.status,
    alasanBatal: null,
    keterangan: null,
    jenisTagihan: 1,
    nilaiPokok: baris.faktur.nilai,
    biayaAdmin: 0,
    dokumen: [
      { kodeDokumen: "JP-000201", tanggal: "2026-10-20", jumlah: 6_000_000 },
      { kodeDokumen: "JP-000202", tanggal: "2026-10-27", jumlah: 4_000_000 },
    ],
    totalDokumen: 10_000_000,
    dokumenTanpaBuku: 0,
    pembayaran: [],
    pembayaranTerpotong: false,
    ...o,
  };
}

const HALAMAN_PELANGGAN = "/keuangan/unit/6400001/piutang/2026-11-12/pelanggan/P-002";
const html = (r: TagihanFakturRinci, pelangganHref: string | null = HALAMAN_PELANGGAN): string => renderToStaticMarkup(
  <TagihanFakturView
    unit={CONTOH_UNIT}
    rinci={r}
    daftarHref="/keuangan/unit/6400001/tagihan"
    pelangganHref={pelangganHref}
  />,
);

describe("S2 — rincian faktur", () => {
  it("kartu kepala: pelanggan, nomor, tanggal, jatuh tempo + sumber, nilai, dibayar, sisa, dan kedua pil", () => {
    const h = html(rinci(CONTOH.sebagianLewat(), { pembayaran: [contohPembayaran({ kode: "BY-0001" })] }));
    expect(h).toContain("Faktur TG-0002");
    expect(h).toContain("CV Mitra Contoh");
    expect(h).toContain("P-002");
    expect(h).toContain("Data EasyMax terakhir masuk");
    const kartu = h.slice(h.indexOf('aria-label="Ringkasan faktur"'), h.indexOf("tagihan-dokumen-judul"));
    expect(kartu).toMatch(/<dt>Tanggal faktur<\/dt><dd><span class="num">29 Okt 2026</);
    expect(kartu).toMatch(/<dt>Jatuh tempo<\/dt><dd><span class="num">12 Nov 2026<\/span><span class="tagihan-sub">dari EasyMax</);
    expect(kartu).toMatch(/<dt>Nilai faktur<\/dt><dd><span class="num">Rp 10\.000\.000</);
    expect(kartu).toMatch(/<dt>Dibayar<\/dt><dd><span class="num">Rp 4\.000\.000</);
    expect(kartu).toMatch(/<dt>Sisa<\/dt><dd><span class="num w600">Rp 6\.000\.000</);
    expect(kartu).toContain('class="status-pill danger">Lewat 1 hari<');
    expect(kartu).toContain('class="status-pill warning">Sebagian<');
  });

  it("tautan kembali ke daftar dan ke halaman pelanggan", () => {
    const h = html(rinci(CONTOH.lewat()));
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan">← Kembali ke daftar</a>');
    expect(h).toContain('href="/keuangan/unit/6400001/piutang/2026-11-12/pelanggan/P-002">Halaman pelanggan</a>');
  });

  it("🔴 halaman pelanggan tak ada (href null): nama & kode tampil sebagai teks biasa, tanpa tautan yang berujung 404", () => {
    const h = html(rinci(CONTOH.sebagianLewat()), null);
    expect(h).not.toContain("Halaman pelanggan");
    expect(h).not.toContain("/piutang/");
    expect(h).toMatch(/<dt>Pelanggan<\/dt><dd><span>CV Mitra Contoh<\/span><span class="tagihan-sub mono">P-002<\/span>/);
    // Tautan kembali ke daftar tetap ada.
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan">← Kembali ke daftar</a>');
    // Kontrol: dengan href, nama pelanggan adalah tautan.
    expect(html(rinci(CONTOH.sebagianLewat()))).toContain(`<a href="${HALAMAN_PELANGGAN}">CV Mitra Contoh</a>`);
  });

  it("🔴 nilai faktur kosong: ditandai dan dijelaskan, tanpa 'Rp 0', dan tidak berpil Lunas", () => {
    const h = html(rinci(CONTOH.nilaiKosong()));
    const kartu = h.slice(h.indexOf('aria-label="Ringkasan faktur"'), h.indexOf("</section>"));
    expect(kartu).toMatch(/<dt>Nilai faktur<\/dt><dd><span class="num">—<\/span><span class="tagihan-sub tagihan-tanda">nilai faktur kosong</);
    expect(kartu).toMatch(/<dt>Sisa<\/dt><dd><span class="num w600">—</);
    expect(kartu).not.toContain(">Lunas<");
    expect(h).toContain("data-tagihan-nilai-kosong");
    expect(h).toContain("SolaMax tidak menganggapnya lunas");
    // Faktur bernilai tak membawa penanda itu.
    expect(html(rinci(CONTOH.lewat()))).not.toContain("nilai faktur kosong");
    expect(html(rinci(CONTOH.lewat()))).not.toContain("data-tagihan-nilai-kosong");
  });

  it("🔴 pembayaran terpotong: dikatakan, termasuk bahwa dibayar/sisa/status ikut tak lengkap", () => {
    const bayar = [contohPembayaran({ kode: "BY-0001" })];
    const h = html(rinci(CONTOH.sebagianLewat(), { pembayaran: bayar, pembayaranTerpotong: true }));
    expect(h).toContain("data-tagihan-bayar-terpotong");
    expect(h).toContain("Hanya 5.000 pembayaran terbaru yang dibaca");
    expect(h).toContain("tidak lengkap");
    expect(html(rinci(CONTOH.sebagianLewat(), { pembayaran: bayar }))).not.toContain("data-tagihan-bayar-terpotong");
  });

  it("🔴 panel beda dengan EasyMax TIDAK ada bila tak satu pun penanda terpasang", () => {
    for (const baris of [CONTOH.lewat(), CONTOH.sebagianLewat(), CONTOH.lunas(), CONTOH.lebihBayar()]) {
      const h = html(rinci(baris));
      expect(h).not.toContain("Beda dengan EasyMax");
      expect(h).not.toContain("Tercatat di EasyMax");
    }
  });

  it("🔴 penanda terpasang → hitungan SolaMax dan nilai EasyMax berdampingan (R4, AE5)", () => {
    const h = html(rinci(CONTOH.bedaEasymax()));
    const panel = h.slice(h.indexOf("tagihan-beda"), h.indexOf("tagihan-dokumen-judul"));
    expect(panel).toContain("Beda dengan EasyMax");
    expect(panel).toMatch(/<th scope="row">Status bayar<\/th><td>Sebagian<\/td><td>Lunas<\/td>/);
    expect(panel).toMatch(/<th scope="row">Sisa tagihan<\/th><td class="num">Rp 6\.000\.000<\/td><td class="num">Rp0?[^<]*<\/td>/);
    // Jatuh temponya wajar: baris itu tidak ikut.
    expect(panel).not.toContain('<th scope="row">Jatuh tempo</th>');
  });

  it("hanya penanda yang terpasang yang punya baris: beda sisa saja", () => {
    const baris = CONTOH.lewat();
    const faktur = { ...baris.faktur, sisaEasymax: 9_000_000 };
    const status = deriveTagihanStatus(faktur, [], { terminPelanggan: null, terminUnit: 30 }, CONTOH_HARI_INI)!;
    expect(status.bedaSisa).toBe(true);
    expect(status.bedaStatus).toBe(false);
    const h = html(rinci(baris, { faktur, status }));
    expect(h).toMatch(/<th scope="row">Sisa tagihan<\/th><td class="num">Rp 10\.000\.000<\/td><td class="num">Rp 9\.000\.000<\/td>/);
    expect(h).not.toContain('<th scope="row">Status bayar</th>');
  });

  it("jatuh tempo EasyMax tak wajar: tanggal mentahnya tampil di panel sebagai 'tidak dipakai' (AE9)", () => {
    const h = html(rinci(CONTOH.jtTakWajar()));
    const panel = h.slice(h.indexOf("tagihan-beda"), h.indexOf("tagihan-dokumen-judul"));
    expect(panel).toMatch(/<th scope="row">Jatuh tempo<\/th><td class="num">31 Okt 2026<\/td><td class="num">1 Jan 2060<span class="tagihan-sub">tidak dipakai</);
    expect(panel).toContain("lebih dari 365 hari");
    expect(panel).not.toContain('<th scope="row">Status bayar</th>');
  });

  it("🔴 faktur batal: dinyatakan jelas beserta alasannya, tanpa status, dibayar, atau sisa", () => {
    const baris = CONTOH.sebagianLewat();
    const h = html(rinci(baris, {
      faktur: { ...baris.faktur, batal: true },
      status: null,
      alasanBatal: "Salah pelanggan",
      pembayaran: [contohPembayaran({ kode: "BY-0009", fakturBatal: true })],
    }));
    expect(h).toContain("<strong>Faktur batal</strong>");
    expect(h).toContain("Alasan: Salah pelanggan.");
    expect(h).toContain('class="status-pill danger">Faktur batal<');
    expect(h).not.toContain("<dt>Dibayar</dt>");
    expect(h).not.toContain("<dt>Sisa</dt>");
    expect(h).not.toContain("<dt>Jatuh tempo</dt>");
    expect(h).not.toContain("Lewat 1 hari");
    // Pembayaran pada faktur batal tetap terlihat, tetapi tidak dihitung.
    expect(h).toContain("BY-0009");
    expect(h).toMatch(/data-tagihan-total-bayar="true">Rp 0</);
    // Tanpa alasan tercatat: dikatakan, bukan dikosongkan.
    const tanpa = html(rinci(baris, { faktur: { ...baris.faktur, batal: true }, status: null }));
    expect(tanpa).toContain("Alasan pembatalan tidak dicatat di EasyMax.");
  });

  it("dokumen penjualan: nomor, tanggal, jumlah, dan totalnya", () => {
    const h = html(rinci(CONTOH.lewat()));
    expect(h).toContain("Dokumen penjualan dalam faktur ini");
    expect(h).toMatch(/JP-000201<\/td><td class="num">20 Okt 2026<\/td><td class="right num">Rp 6\.000\.000</);
    expect(h).toMatch(/Total dokumen<\/th><td class="right num w600">Rp 10\.000\.000</);
    expect(h).not.toContain("tidak ditemukan di buku piutang");
  });

  it("🔴 dokumen yang tak ada di buku piutang: jumlah '—', dan catatan yang menghitungnya", () => {
    const h = html(rinci(CONTOH.lewat(), {
      dokumen: [
        { kodeDokumen: "JP-000201", tanggal: "2026-10-20", jumlah: 6_000_000 },
        { kodeDokumen: "JP-000299", tanggal: null, jumlah: null },
      ],
      totalDokumen: 6_000_000,
      dokumenTanpaBuku: 1,
    }));
    expect(h).toMatch(/JP-000299<\/td><td class="num">—<\/td><td class="right num">—<\/td>/);
    expect(h).toContain("1 dokumen tidak ditemukan di buku piutang");
    expect(h).toMatch(/Total dokumen<\/th><td class="right num w600">Rp 6\.000\.000</);
  });

  it("🔴 pembayaran batal: tampil dicoret dengan alasannya, dan TIDAK ikut total (R6, R17)", () => {
    const h = html(rinci(CONTOH.sebagianLewat(), {
      pembayaran: [
        contohPembayaran({ kode: "BY-0002", tanggal: "2026-11-06", jumlah: 6_000_000, batal: true, alasanBatal: "Salah input" }),
        contohPembayaran({ kode: "BY-0001", jumlah: 4_000_000 }),
      ],
    }));
    const tabel = h.slice(h.indexOf('aria-label="Pembayaran faktur TG-0002"'));
    const [, batal, hidup] = tabel.split("<tr").slice(1);
    expect(batal).toContain('class="tagihan-batal"');
    expect(batal).toContain('<span class="tagihan-coret mono">BY-0002</span>');
    expect(batal).toContain('<span class="tagihan-coret">Rp 6.000.000</span>');
    expect(batal).toContain("Batal — Salah input");
    expect(hidup).not.toContain("tagihan-batal");
    expect(hidup).toContain("BY-0001");
    // Total = hanya pembayaran hidup: 4 jt, bukan 10 jt.
    expect(tabel).toMatch(/data-tagihan-total-bayar="true">Rp 4\.000\.000</);
    expect(tabel).toContain("1 pembayaran batal atau pada faktur batal tidak dihitung");
    expect(h).toContain("2 pembayaran tercatat · Rp 4.000.000 dihitung");
  });

  it("tanpa pembayaran: keadaan kosong, bukan tabel bertotal nol", () => {
    const h = html(rinci(CONTOH.lewat()));
    expect(h).toContain("Belum ada pembayaran tercatat untuk faktur ini.");
    expect(h).not.toContain("data-tagihan-total-bayar");
  });
});
