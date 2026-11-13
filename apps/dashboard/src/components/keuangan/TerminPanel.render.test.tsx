import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PelangganTerminRow, TerminUnitRow } from "@/lib/termin-queries";

/**
 * S4 — Atur termin (rencana 2026-11-13 U9). Render STATIS (repo tanpa jsdom):
 * yang dijaga adalah apa yang ADA di markup awal — kolom isian hanya bagi yang
 * berwenang, siapa & kapan tampil, pengecualian yatim ditandai. Penolakan di
 * SERVER diuji `termin-actions.test.ts`; menyembunyikan kolom bukan gerbangnya.
 * Semua nama, kode dan angka ilustratif.
 */
vi.mock("@/lib/termin-actions", () => ({
  tetapkanTerminUnit: vi.fn(),
  tetapkanTerminPelanggan: vi.fn(),
  hapusTerminPelanggan: vi.fn(),
}));

const { TerminPanel, TERMIN_BARIS_MAKS, bacaTerminHari, saringPelangganTermin, urutkanPelangganTermin } =
  await import("./TerminPanel");

const BATAS = { min: 0, maks: 365 };
const PESAN = "Hanya tim Finance yang boleh mengatur termin pembayaran.";
const UNIT: TerminUnitRow = { terminHari: 30, diaturOleh: "staf@contoh.test", diaturAt: "2026-01-05 09:30" };

const plg = (o: Partial<PelangganTerminRow> & { kodePelanggan: string }): PelangganTerminRow => ({
  namaPelanggan: `Pelanggan ${o.kodePelanggan}`,
  diMaster: true,
  kelas: 1,
  terminHari: null,
  diaturOleh: null,
  diaturAt: null,
  ...o,
});

const PELANGGAN: PelangganTerminRow[] = [
  plg({ kodePelanggan: "PLG001", namaPelanggan: "Contoh Angkutan" }),
  plg({
    kodePelanggan: "PLG002",
    namaPelanggan: "Contoh Bangunan",
    terminHari: 14,
    diaturOleh: "hof@contoh.test",
    diaturAt: "2026-01-06 10:15",
  }),
  plg({
    kodePelanggan: "LAMA/01",
    namaPelanggan: null,
    diMaster: false,
    terminHari: 7,
    diaturOleh: null,
    diaturAt: "2026-01-02 08:00",
  }),
];

const render = (o: {
  bolehAtur: boolean;
  terminUnit?: TerminUnitRow | null;
  pelanggan?: PelangganTerminRow[];
  cariAwal?: string;
  cakupan?: Parameters<typeof TerminPanel>[0]["cakupan"];
}) =>
  renderToStaticMarkup(
    <TerminPanel
      code="6378301"
      namaUnit="Unit Contoh"
      terminUnit={o.terminUnit === undefined ? UNIT : o.terminUnit}
      pelanggan={o.pelanggan ?? PELANGGAN}
      bolehAtur={o.bolehAtur}
      pesanTakBoleh={PESAN}
      batas={BATAS}
      cariAwal={o.cariAwal}
      cakupan={o.cakupan}
    />,
  );

/** Potongan markup satu baris pelanggan. */
const baris = (html: string, kode: string): string => {
  const awal = html.indexOf(`data-termin-baris="${kode}"`);
  expect(awal, `baris ${kode} tidak dirender`).toBeGreaterThan(-1);
  const berikut = html.indexOf("data-termin-baris=", awal + 1);
  return html.slice(awal, berikut === -1 ? undefined : berikut);
};

describe("tanpa wewenang — hanya baca", () => {
  const html = render({ bolehAtur: false });

  it("menjelaskan kenapa, dengan pesan yang diserahkan server", () => {
    expect(html).toContain("data-termin-baca-saja");
    expect(html).toContain(PESAN);
  });

  it("🔴 tak ada kolom isian termin dan tak ada tombol tindakan", () => {
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('name="terminUnit"');
    expect(html).not.toContain('name="terminPelanggan"');
    expect(html).not.toContain("<button");
    for (const s of ["Simpan termin bawaan", "Atur pengecualian", "Ubah", "Hapus pengecualian"]) {
      expect(html, s).not.toContain(s);
    }
    // Satu-satunya <input> yang tersisa adalah penyaring tampilan.
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('type="search"');
  });

  it("isinya tetap terbaca seluruhnya: termin bawaan, pengecualian, dan pelanggan tanpa pengecualian", () => {
    expect(html).toContain("30 hari");
    expect(baris(html, "PLG002")).toContain("14 hari");
    expect(baris(html, "PLG001")).toContain("pakai bawaan unit");
    expect(baris(html, "LAMA/01")).toContain("7 hari");
  });
});

describe("dengan wewenang", () => {
  const html = render({ bolehAtur: true });

  it("tak ada penjelasan hanya-baca", () => {
    expect(html).not.toContain("data-termin-baca-saja");
    expect(html).not.toContain(PESAN);
  });

  it("kolom termin bawaan: angka, 0–365, terisi nilai yang berlaku, dengan tombol simpan", () => {
    const input = /<input[^>]*name="terminUnit"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('type="number"');
    expect(input).toContain('min="0"');
    expect(input).toContain('max="365"');
    expect(input).toContain('value="30"');
    expect(html).toContain("Simpan termin bawaan");
  });

  it("tindakan per baris sesuai keadaannya", () => {
    const tanpa = baris(html, "PLG001");
    expect(tanpa).toContain("Atur pengecualian");
    expect(tanpa).not.toContain("Hapus pengecualian");
    const punya = baris(html, "PLG002");
    expect(punya).toContain("Ubah");
    expect(punya).toContain("Hapus pengecualian");
  });

  it("markup awal tak memuat pesan galat maupun pesan hasil", () => {
    expect(html).not.toContain("data-termin-galat");
    expect(html).not.toContain("data-termin-pesan");
    expect(html).not.toContain('role="alert"');
  });
});

describe("siapa & kapan (R16)", () => {
  it("termin bawaan menyebut penetap dan waktunya", () => {
    const html = render({ bolehAtur: false });
    expect(html).toContain("Diatur oleh staf@contoh.test · 2026-01-05 09:30 WIB");
  });

  it("pengecualian pelanggan menyebut penetap dan waktunya; tanpa pengecualian tak mengarang", () => {
    const html = render({ bolehAtur: false });
    expect(baris(html, "PLG002")).toContain("hof@contoh.test · 2026-01-06 10:15 WIB");
    expect(baris(html, "PLG001")).not.toContain("WIB");
  });

  it("penetap yang akunnya sudah tak ada tetap punya waktu", () => {
    const html = render({ bolehAtur: false });
    expect(baris(html, "LAMA/01")).toContain("akun yang sudah dihapus · 2026-01-02 08:00 WIB");
  });

  it("termin bawaan yang belum pernah diatur disebut apa adanya, bukan 0 hari", () => {
    const html = render({ bolehAtur: true, terminUnit: null });
    expect(html).toContain("Belum diatur");
    expect(html).toContain("Termin belum diatur");
    expect(html).not.toContain("Diatur oleh staf@contoh.test");
    // Kolom isiannya kosong, bukan "0".
    expect(/<input[^>]*name="terminUnit"[^>]*>/.exec(html)?.[0]).toContain('value=""');
    // Pelanggan tanpa pengecualian ikut "belum diatur".
    expect(baris(html, "PLG001")).toContain("belum diatur");
  });
});

describe("pengecualian yatim — pelanggan tak ada lagi di master", () => {
  it("ditandai di barisnya dan diringkas di atas daftar", () => {
    const html = render({ bolehAtur: true });
    const yatim = baris(html, "LAMA/01");
    expect(yatim).toContain("data-termin-yatim");
    expect(yatim).toContain("tidak ada di master");
    expect(yatim).toContain("Nama tidak tersedia");
    expect(html).toContain("data-termin-yatim-ringkas");
    // Pelanggan yang masih di master TIDAK ditandai.
    expect(baris(html, "PLG002")).not.toContain("tidak ada di master");
    expect(baris(html, "PLG002")).not.toContain("data-termin-yatim");
  });

  it("hanya bisa dihapus pengecualiannya, tidak diberi termin baru", () => {
    const yatim = baris(render({ bolehAtur: true }), "LAMA/01");
    expect(yatim).toContain("Hapus pengecualian");
    expect(yatim).not.toContain("Ubah");
    expect(yatim).not.toContain("Atur pengecualian");
  });

  it("tanpa pengecualian yatim, ringkasannya tak muncul", () => {
    const html = render({ bolehAtur: true, pelanggan: PELANGGAN.filter((p) => p.diMaster) });
    expect(html).not.toContain("data-termin-yatim-ringkas");
  });

  it("tampil paling atas — tak tenggelam di bawah ratusan pelanggan", () => {
    const html = render({ bolehAtur: true });
    expect(html.indexOf('data-termin-baris="LAMA/01"')).toBeLessThan(html.indexOf('data-termin-baris="PLG002"'));
    expect(html.indexOf('data-termin-baris="PLG002"')).toBeLessThan(html.indexOf('data-termin-baris="PLG001"'));
  });
});

describe("daftar pelanggan — pencarian & batas baris", () => {
  it("pencarian awal menyaring menurut nama atau kode", () => {
    const nama = render({ bolehAtur: true, cariAwal: "bangunan" });
    expect(nama).toContain('data-termin-baris="PLG002"');
    expect(nama).not.toContain('data-termin-baris="PLG001"');
    const kode = render({ bolehAtur: true, cariAwal: "plg001" });
    expect(kode).toContain('data-termin-baris="PLG001"');
    expect(kode).not.toContain('data-termin-baris="PLG002"');
  });

  it("pencarian tanpa hasil menyebutnya; master kosong menyebut hal yang berbeda", () => {
    expect(render({ bolehAtur: true, cariAwal: "zzz" })).toContain("Tidak ada pelanggan yang cocok");
    expect(render({ bolehAtur: true, pelanggan: [] })).toContain("Belum ada pelanggan di master unit ini");
  });

  it("lebih dari batas baris: dipotong dan DIKATAKAN", () => {
    const banyak = Array.from({ length: TERMIN_BARIS_MAKS + 5 }, (_, i) =>
      plg({ kodePelanggan: `P${String(i).padStart(4, "0")}` }),
    );
    const html = render({ bolehAtur: false, pelanggan: banyak });
    expect(html.match(/data-termin-baris=/g)).toHaveLength(TERMIN_BARIS_MAKS);
    expect(html).toContain("data-termin-terpotong");
    expect(html).toContain(`Menampilkan ${TERMIN_BARIS_MAKS} dari ${TERMIN_BARIS_MAKS + 5} pelanggan`);
    // Tepat di batas: tak ada catatan terpotong.
    expect(render({ bolehAtur: false, pelanggan: banyak.slice(0, TERMIN_BARIS_MAKS) })).not.toContain(
      "data-termin-terpotong",
    );
  });
});

describe("cakupan daftar — pelanggan piutang (bawaan) atau seluruh master", () => {
  const HREF = {
    hrefSemua: "/keuangan/unit/6378301/tagihan/termin?semua=1",
    hrefPiutang: "/keuangan/unit/6378301/tagihan/termin",
  };

  it("bawaan: menyebut yang ditampilkan dari berapa, dan menaut ke seluruh master lewat GET", () => {
    const html = render({ bolehAtur: true, cakupan: { semua: false, jumlahMaster: 240, ...HREF } });
    expect(html).toContain('data-termin-cakupan="piutang"');
    expect(html).toContain("Menampilkan pelanggan piutang dan pelanggan yang sudah punya pengecualian — 3 dari 240 pelanggan.");
    expect(html).toContain(`<a href="${HREF.hrefSemua}">Tampilkan semua pelanggan</a>`);
    expect(html).not.toContain("Hanya pelanggan piutang");
  });

  it("semua: mengatakannya, dan menaut kembali ke daftar pelanggan piutang", () => {
    const html = render({ bolehAtur: false, cakupan: { semua: true, jumlahMaster: 3, ...HREF } });
    expect(html).toContain('data-termin-cakupan="semua"');
    expect(html).toContain("Menampilkan semua pelanggan master");
    expect(html).toContain(`<a href="${HREF.hrefPiutang}">Hanya pelanggan piutang</a>`);
    expect(html).not.toContain("Tampilkan semua pelanggan");
  });

  it("daftar bawaan kosong padahal master berisi: tidak disebut 'belum ada pelanggan di master'", () => {
    const html = render({ bolehAtur: true, pelanggan: [], cakupan: { semua: false, jumlahMaster: 12, ...HREF } });
    expect(html).toContain("Tidak ada pelanggan piutang maupun pelanggan berpengecualian di unit ini.");
    expect(html).not.toContain("Belum ada pelanggan di master unit ini");
    expect(html).toContain("Tampilkan semua pelanggan");
  });

  it("tanpa cakupan (pemanggil tak menyaring): tak ada catatan maupun tautan", () => {
    expect(render({ bolehAtur: true })).not.toContain("data-termin-cakupan");
  });
});

describe("pembantu murni", () => {
  it("bacaTerminHari: hanya bilangan bulat dalam batas", () => {
    expect(bacaTerminHari("0", BATAS)).toBe(0);
    expect(bacaTerminHari(" 30 ", BATAS)).toBe(30);
    expect(bacaTerminHari("365", BATAS)).toBe(365);
    for (const salah of ["", "366", "-1", "1.5", "1e2", "tiga", "0030"]) {
      expect(bacaTerminHari(salah, BATAS), salah).toBeNull();
    }
  });

  it("urutkanPelangganTermin tak mengubah larik masukan; saring kosong memulangkan semuanya", () => {
    const asal = [...PELANGGAN];
    const urut = urutkanPelangganTermin(PELANGGAN);
    expect(PELANGGAN).toEqual(asal);
    expect(urut.map((p) => p.kodePelanggan)).toEqual(["LAMA/01", "PLG002", "PLG001"]);
    expect(saringPelangganTermin(PELANGGAN, "  ")).toHaveLength(PELANGGAN.length);
  });
});
