import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TAGIHAN_BELUM_TERSEDIA, type BelumDitagihkanDaftar } from "@/lib/tagihan-queries";
import { TAGIHAN_TAMPILAN, normalizeTagihanView, type TagihanTampilan } from "@/lib/tagihan-route";
import {
  CONTOH,
  CONTOH_HARI_INI,
  CONTOH_KESIAPAN,
  CONTOH_UNIT,
  contohBaris,
  contohCocok,
  contohDaftar,
  contohUbin,
} from "./TagihanContoh";
import { TagihanStatusPills } from "./TagihanTabel";
import { TagihanView, tagihanKosongLabel, type TagihanViewProps } from "./TagihanView";

// Komponen membaca konstanta dari `tagihan-queries`, yang memuat `db` (pool
// dibuat saat impor). Render statis tak pernah menyentuh basis data.
vi.mock("@/lib/db", () => ({ qScoped: vi.fn() }));

/** Semua nilai ilustratif. */
const view = (input: Parameters<typeof normalizeTagihanView>[0] = {}) => normalizeTagihanView(input, CONTOH_HARI_INI);
const umum = { unit: CONTOH_UNIT, hariIni: CONTOH_HARI_INI };
const html = (props: TagihanViewProps): string => renderToStaticMarkup(<TagihanView {...props} />);
const pil = (b: ReturnType<typeof contohBaris>): string =>
  renderToStaticMarkup(<TagihanStatusPills status={b.status} />);
/** Satu `<tr>` per nomor faktur — supaya asersi tak tertukar antar-baris. */
const barisHtml = (h: string, kode: string): string => {
  const ketemu = h.split("<tr").find((tr) => tr.includes(`>${kode}</a>`));
  if (!ketemu) throw new Error(`baris ${kode} tidak ada di tabel`);
  return ketemu;
};

const semua = [
  CONTOH.lewat(), CONTOH.sebagianLewat(), CONTOH.belumJatuhTempo(), CONTOH.terminBelumDiatur(),
  CONTOH.lebihBayar(), CONTOH.bedaEasymax(), CONTOH.jtTakWajar(),
];

const belumDitagihkan = (o: Partial<BelumDitagihkanDaftar> = {}): BelumDitagihkanDaftar => ({
  tersedia: true,
  kesiapan: CONTOH_KESIAPAN,
  ubin: contohUbin(semua),
  fakturBergantungTermin: 0,
  terpotong: false,
  cari: "",
  kelompok: [
    { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", jumlahDokumen: 2, total: 1_250_000,
      tanggalTertua: "2026-11-03", cocokSaldo: contohCocok() },
    { customerCode: "21.7", namaPelanggan: null, jumlahDokumen: 1, total: 500_000,
      tanggalTertua: "2026-11-09",
      cocokSaldo: contohCocok({ sisaFaktur: 0, belumDitagihkan: 500_000, jumlah: 500_000, kelompokSaldo: "online",
        saldoPiutang: null, saldoPerTanggal: null, selisih: null }) },
  ],
  saldoPerTanggal: "2026-11-12",
  saldoSedangDiperbarui: false,
  ...o,
});

describe("pil status — setiap status punya pilnya", () => {
  it("lewat jatuh tempo: pil bahaya dengan jumlah hari", () => {
    const h = pil(CONTOH.lewat());
    expect(h).toContain('class="status-pill danger">Lewat 13 hari<');
    expect(h.match(/status-pill/g)).toHaveLength(1);
  });

  it("belum jatuh tempo: pil netral dengan sisa hari", () => {
    expect(pil(CONTOH.belumJatuhTempo())).toContain('class="status-pill neutral">Jatuh tempo 11 hari lagi<');
  });

  it("termin belum diatur: pil peringatan, bukan pil lewat", () => {
    const h = pil(CONTOH.terminBelumDiatur());
    expect(h).toContain('class="status-pill warning">Termin belum diatur<');
    expect(h).not.toContain("Lewat");
  });

  it("lunas: satu pil sukses, tanpa pil jatuh tempo", () => {
    const h = pil(CONTOH.lunas());
    expect(h).toContain('class="status-pill success">Lunas<');
    expect(h.match(/status-pill/g)).toHaveLength(1);
  });

  it("lebih bayar: satu pil info, tanpa pil jatuh tempo", () => {
    const h = pil(CONTOH.lebihBayar());
    expect(h).toContain('class="status-pill info">Lebih bayar<');
    expect(h.match(/status-pill/g)).toHaveLength(1);
  });

  it("🔴 dibayar sebagian DAN lewat jatuh tempo: KEDUA pil tampil (R5, AE2)", () => {
    const h = pil(CONTOH.sebagianLewat());
    expect(h).toContain('class="status-pill danger">Lewat 1 hari<');
    expect(h).toContain('class="status-pill warning">Sebagian<');
    expect(h.match(/status-pill/g)).toHaveLength(2);
  });
});

describe("S1 — daftar tagihan", () => {
  const siap = (o: Parameters<typeof contohDaftar>[1] = {}, v = view()) =>
    html({ ...umum, view: v, state: "faktur", data: contohDaftar(semua, o) });

  it("kepala: judul, unit, kesegaran data, Atur termin, dan Ekspor CSV saringan aktif", () => {
    const h = siap();
    expect(h).toContain("<h1 class=\"text-h3 t-brand\">Tagihan pelanggan</h1>");
    expect(h).toContain("SPBU 6400001 · SPBU Contoh");
    expect(h).toContain("Data EasyMax terakhir masuk");
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan/termin">Atur termin</a>');
    expect(h).toContain('href="/api/keuangan/unit/6400001/tagihan/csv?filter=perlu_tindakan">Ekspor CSV</a>');
  });

  it("🔴 tampilan bawaan = Perlu tindakan, dan hanya saringan itu yang aktif", () => {
    const v = view();
    expect(v.tampilan).toBe("perlu_tindakan");
    const h = siap({}, v);
    const aktif = h.match(/<a[^>]*aria-current="page"[^>]*>[^<]*<\/a>/g) ?? [];
    expect(aktif).toHaveLength(1);
    expect(aktif[0]).toContain(">Perlu tindakan<");
    // Keenam saringan ada, masing-masing tautan ke tampilannya.
    for (const tampilan of TAGIHAN_TAMPILAN) {
      expect(h).toContain(`href="/keuangan/unit/6400001/tagihan?filter=${tampilan}"`);
    }
  });

  it("baris terurut hari lewat terbanyak dulu (urutan model dipertahankan tabel)", () => {
    const h = siap();
    const urutan = [...h.matchAll(/class="tagihan-kode mono"[^>]*>([^<]+)</g)].map((m) => m[1]);
    // Lewat 13 hari (tiga faktur, urut kode) → lewat 1 hari → belum jatuh tempo → tanpa tanggal.
    expect(urutan.slice(0, 4)).toEqual(["TG-0001", "TG-0007", "TG-0008", "TG-0002"]);
    expect(urutan.at(-1)).toBe("TG-0004");
    expect(urutan).toHaveLength(semua.length);
  });

  it("kolom rencana lengkap, tiap baris menaut ke rincian fakturnya", () => {
    const h = siap();
    for (const kolom of ["Pelanggan · no. faktur", "Tgl faktur", "Jatuh tempo", "Nilai", "Dibayar", "Sisa", "Status"]) {
      expect(h).toContain(`>${kolom}</th>`);
    }
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan/faktur/TG-0002"');
    const baris = barisHtml(h, "TG-0002");
    expect(baris).toContain("CV Mitra Contoh");
    expect(baris).toContain("Rp 10.000.000");
    expect(baris).toContain("Rp 4.000.000");
    expect(baris).toContain("Rp 6.000.000");
    expect(baris).toContain("Lewat 1 hari");
    expect(baris).toContain("Sebagian");
  });

  it("sumber jatuh tempo tampil sebagai sub-baris (R13)", () => {
    const h = siap();
    expect(barisHtml(h, "TG-0002")).toContain(">dari EasyMax<");
    expect(barisHtml(h, "TG-0001")).toContain(">termin 30 hari<");
    expect(barisHtml(h, "TG-0003")).toContain(">termin 14 hari<");
    // Termin belum diatur: tak ada sumber, tak ada tanggal.
    expect(barisHtml(h, "TG-0004")).not.toMatch(/termin \d+ hari|dari EasyMax/);
  });

  it("penanda beda dengan EasyMax: sub-baris pendek + penjelasan di title, HANYA di baris yang berbeda", () => {
    const h = siap();
    const beda = barisHtml(h, "TG-0007");
    expect(beda).toMatch(/title="[^"]*tidak sama dengan yang tercatat di EasyMax[^"]*">beda dengan EasyMax</);
    expect(h.match(/>beda dengan EasyMax</g)).toHaveLength(1);
    expect(barisHtml(h, "TG-0001")).not.toContain("beda dengan EasyMax");
  });

  it("jatuh tempo EasyMax tak wajar: sub-baris pendek, tanggalnya tidak dipakai", () => {
    const h = siap();
    const baris = barisHtml(h, "TG-0008");
    expect(baris).toMatch(/title="[^"]*lebih dari 365 hari[^"]*">JT EasyMax tak wajar</);
    expect(baris).toContain(">termin 30 hari<");
    // Yang TAMPIL adalah jatuh tempo dari termin; tanggal mentah EasyMax hanya di `title`.
    expect(baris).toContain('<td class="num">31 Okt 2026<');
    expect(baris.replace(/title="[^"]*"/g, "")).not.toContain("2060");
    expect(h.match(/>JT EasyMax tak wajar</g)).toHaveLength(1);
  });

  it("lebih bayar: kelebihannya tampil sebagai sisa negatif", () => {
    expect(barisHtml(siap(), "TG-0006")).toContain("−Rp 50.000");
  });

  it("empat ubin: rupiah + jumlah, masing-masing tautan saringan", () => {
    const h = siap();
    const ubin = h.slice(h.indexOf('aria-label="Ringkasan tagihan"'), h.indexOf("tagihan-kontrol"));
    expect(ubin.match(/<a /g)).toHaveLength(4);
    // Lewat: 10 jt + 6 jt + 6 jt + 10 jt = 32 jt dari empat faktur.
    expect(ubin).toMatch(/filter=lewat_jatuh_tempo">.*Lewat jatuh tempo.*Rp 32\.000\.000.*4 faktur/);
    expect(ubin).toMatch(/Belum jatuh tempo.*Rp 10\.000\.000.*1 faktur/);
    expect(ubin).toMatch(/Termin belum diatur.*Rp 10\.000\.000.*1 faktur/);
    expect(ubin).toMatch(/filter=belum_ditagihkan">.*Belum ditagihkan.*Rp 1\.750\.000.*3 dokumen · 2 pelanggan/);
  });

  it("ubin Termin belum diatur tak nol → spanduk info yang menaut ke Atur termin", () => {
    const h = siap();
    expect(h).toContain("1 faktur belum punya termin (Rp 10.000.000)");
    expect(h).toContain('<a href="/keuangan/unit/6400001/tagihan/termin">Atur termin pembayaran</a>');
    // Tanpa faktur tak bertermin: spanduknya hilang.
    const tanpa = html({ ...umum, view: view(), state: "faktur", data: contohDaftar([CONTOH.lewat()]) });
    expect(tanpa).not.toContain("belum punya termin");
  });

  it("🔴 terpotong: spanduk peringatan bahwa angka tidak lengkap; tanpa itu spanduknya tak ada", () => {
    const h = siap({ terpotong: true });
    expect(h).toContain('class="banner warning" role="alert"');
    expect(h).toContain("Daftar terpotong — angka di layar ini tidak lengkap");
    expect(siap()).not.toContain("Daftar terpotong");
  });

  it("pencarian: formulir GET ber-parameter q yang mempertahankan saringan", () => {
    const h = html({
      ...umum, view: view({ filter: "sebagian", search: "mitra" }), state: "faktur",
      data: contohDaftar([CONTOH.sebagianLewat()], { filter: "sebagian", cari: "mitra" }),
    });
    expect(h).toMatch(/<form method="get" class="b6-piutang-search"><input type="hidden" name="filter" value="sebagian"\/>/);
    expect(h).toContain('name="q" type="search" value="mitra"');
    // Saringan lain membawa pencariannya.
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan?filter=lunas&amp;q=mitra"');
  });

  it("Lunas: formulir periode from/to, dan periodenya disebut di kepala daftar", () => {
    const v = view({ filter: "lunas" });
    const h = html({
      ...umum, view: v, state: "faktur",
      data: contohDaftar([CONTOH.lunas()], { filter: "lunas", periodeLunas: v.periode }),
    });
    expect(v.periode).toEqual({ from: "2026-10-01", to: "2026-11-30" });
    expect(h).toContain('name="from" type="date" required="" value="2026-10-01"');
    expect(h).toContain('name="to" type="date" required="" value="2026-11-30"');
    expect(h).toContain("dilunasi 1 Okt 2026 – 30 Nov 2026");
    expect(h).toContain('class="status-pill success">Lunas<');
    // Saringan selain Lunas tak punya formulir periode.
    expect(siap()).not.toContain('name="from"');
  });

  it("halaman: tautan Sebelumnya/Berikutnya hanya bila lebih dari satu halaman", () => {
    expect(siap()).not.toContain("Halaman 1 dari");
    const banyak = Array.from({ length: 120 }, (_, i) => contohBaris({ kode: `TG-${String(1000 + i)}` }));
    const h = html({
      ...umum, view: view({ page: "2" }), state: "faktur", data: contohDaftar(banyak, { halaman: 2 }),
    });
    expect(h).toContain("Halaman 2 dari 3");
    expect(h).toContain('rel="prev" href="/keuangan/unit/6400001/tagihan?filter=perlu_tindakan"');
    expect(h).toContain('rel="next" href="/keuangan/unit/6400001/tagihan?filter=perlu_tindakan&amp;page=3"');
    expect(h.match(/class="tagihan-kode mono"/g)).toHaveLength(50);
  });

  it("keadaan kosong punya teks per saringan, dan menyebut pencarian yang aktif", () => {
    const harap: Record<TagihanTampilan, string> = {
      perlu_tindakan: "Tidak ada faktur yang perlu tindakan",
      lewat_jatuh_tempo: "Tidak ada faktur lewat jatuh tempo",
      sebagian: "Tidak ada faktur yang dibayar sebagian",
      lebih_bayar: "Tidak ada faktur lebih bayar",
      lunas: "Tidak ada faktur lunas pada periode ini",
      belum_ditagihkan: "Tidak ada penjualan kredit yang belum ditagihkan",
    };
    for (const tampilan of TAGIHAN_TAMPILAN) expect(tagihanKosongLabel(tampilan, "")).toBe(harap[tampilan]);
    const h = html({
      ...umum, view: view({ filter: "lewat_jatuh_tempo" }), state: "faktur",
      data: contohDaftar([], { filter: "lewat_jatuh_tempo" }),
    });
    expect(h).toContain("Tidak ada faktur lewat jatuh tempo.");
    expect(h).not.toContain("<table");
    expect(tagihanKosongLabel("sebagian", "abc")).toBe("Tidak ada faktur yang dibayar sebagian untuk pencarian “abc”");
  });

  it("🔴 belum tersedia: teks KTD11, tanpa ubin/tabel/ekspor — bukan daftar kosong", () => {
    const h = html({ ...umum, view: view(), state: "belum_tersedia" });
    expect(h).toContain(TAGIHAN_BELUM_TERSEDIA);
    expect(h).toContain("Belum tersedia bukan berarti tidak ada faktur");
    expect(h).not.toContain("tagihan-ubin");
    expect(h).not.toContain("<table");
    expect(h).not.toContain("Ekspor CSV");
    expect(h).not.toContain("Tidak ada faktur");
    // Atur termin tetap terjangkau.
    expect(h).toContain(">Atur termin</a>");
  });
});

describe("S3 — belum ditagihkan", () => {
  const v = (input: Parameters<typeof normalizeTagihanView>[0] = {}) => view({ filter: "belum_ditagihkan", ...input });

  it("kelompok per pelanggan: nama, kode, jumlah dokumen, total, dokumen tertua", () => {
    const h = html({ ...umum, view: v(), state: "belum_ditagihkan", data: belumDitagihkan(), dokumenBuka: null });
    expect(h).toContain(">Belum ditagihkan</h2>");
    expect(h).toContain("PT Pelanggan Contoh");
    expect(h).toContain(">P-001<");
    expect(h).toContain("Rp 1.250.000");
    expect(h).toContain("3 Nov 2026");
    expect(h).toContain("Nama belum tersedia");
    expect(h).toContain(">21.7<");
    // Nama pelanggan menaut ke halaman pelanggan pada tanggal Saldo pelanggan pembanding.
    expect(h).toContain('href="/keuangan/unit/6400001/piutang/2026-11-12/pelanggan/P-001"');
    // Tak ada yang dibuka: tak ada tabel dokumen.
    expect(h).not.toContain("<table");
  });

  it("🔴 baris R20 per pelanggan: jumlah, saldo piutang per tanggal, dan SELISIH-nya", () => {
    const h = html({ ...umum, view: v(), state: "belum_ditagihkan", data: belumDitagihkan(), dokumenBuka: null });
    const [pertama, kedua] = h.split('<article class="tagihan-kelompok').slice(1);
    expect(pertama).toContain("Sisa faktur + belum ditagihkan");
    expect(pertama).toContain("Rp 7.250.000");
    expect(pertama).toContain("Rp 6.000.000 + Rp 1.250.000");
    expect(pertama).toContain("Saldo piutang (Saldo pelanggan, per 12 Nov 2026)");
    expect(pertama).toContain("Rp 7.000.000");
    expect(pertama).toMatch(/<dt>Selisih<\/dt><dd class="num w600">Rp 250\.000<\/dd>/);
    // Tanpa snapshot: "belum tersedia", bukan nol dan bukan selisih karangan.
    expect(kedua).toContain("Saldo piutang (Saldo pelanggan)");
    expect(kedua!.match(/>belum tersedia</g)).toHaveLength(2);
    expect(kedua).not.toMatch(/<dt>Selisih<\/dt><dd[^>]*>Rp/);
  });

  it("buka: kelompok yang dibuka menampilkan dokumennya dan tautannya berubah jadi Tutup", () => {
    const h = html({
      ...umum, view: v({ buka: "P-001" }), state: "belum_ditagihkan", data: belumDitagihkan(),
      dokumenBuka: {
        terpotong: false,
        dokumen: [
          { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "JP-000101", tanggal: "2026-11-03", jumlah: 750_000, keterangan: "Penjualan kredit" },
          { customerCode: "P-001", namaPelanggan: "PT Pelanggan Contoh", kodeDokumen: "UV-000007", tanggal: "2026-11-08", jumlah: 500_000, keterangan: null },
        ],
      },
    });
    expect(h.match(/<table/g)).toHaveLength(1);
    expect(h).toContain(">JP-000101<");
    expect(h).toContain(">UV-000007<");
    expect(h).toContain("Rp 750.000");
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan?filter=belum_ditagihkan" aria-expanded="true">Tutup dokumen</a>');
    // Kelompok lain tetap menawarkan Lihat dokumen, dengan kodenya di `buka`.
    expect(h).toContain('href="/keuangan/unit/6400001/tagihan?filter=belum_ditagihkan&amp;buka=21.7" aria-expanded="false">Lihat dokumen</a>');
  });

  it("saldo pembanding sedang diperbarui → catatan; tanpa itu tak ada", () => {
    const dengan = html({
      ...umum, view: v(), state: "belum_ditagihkan",
      data: belumDitagihkan({ saldoSedangDiperbarui: true }), dokumenBuka: null,
    });
    expect(dengan).toContain("Saldo pelanggan per 12 Nov 2026 sedang diperbarui");
    const tanpa = html({ ...umum, view: v(), state: "belum_ditagihkan", data: belumDitagihkan(), dokumenBuka: null });
    expect(tanpa).not.toContain("sedang diperbarui");
  });

  it("kosong: teks saringannya, dan ekspor tetap menunjuk saringan ini", () => {
    const h = html({
      ...umum, view: v(), state: "belum_ditagihkan", data: belumDitagihkan({ kelompok: [] }), dokumenBuka: null,
    });
    expect(h).toContain("Tidak ada penjualan kredit yang belum ditagihkan.");
    expect(h).toContain('href="/api/keuangan/unit/6400001/tagihan/csv?filter=belum_ditagihkan"');
    const aktif = h.match(/<a[^>]*aria-current="page"[^>]*>[^<]*<\/a>/g) ?? [];
    expect(aktif).toHaveLength(1);
    expect(aktif[0]).toContain(">Belum ditagihkan<");
  });
});
