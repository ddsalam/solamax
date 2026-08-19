import type { SebabKosong } from "./keuangan-laporan-model";

/**
 * Model Layar 5 — Sumber data. MURNI (tanpa I/O).
 *
 * Menjawab satu pertanyaan: **dari mana tiap angka datang.** Mana yang ditarik
 * SolaMax dari EasyMax, mana yang diketik tim keuangan, dan mana yang **belum
 * bersumber sama sekali**.
 *
 * ⛔ **YANG SUDAH DINAMAI TIDAK DIBERI NAMA BARU.** `SebabKosong`
 * (`belum_ada_saldo_pembuka` · `tak_bersumber` · `belum_ada_akun_kas` …) sudah
 * punya arti masing-masing di `keuangan-laporan-model.ts`, dan layar ini
 * MEMAKAINYA. Sinonim baru akan membuat dua layar menyebut keadaan yang sama
 * dengan dua nama, lalu orang berikutnya menduga keduanya berbeda.
 *
 * ⛔ **STATUSNYA HIDUP, BUKAN BROSUR.** Sebagian besar baris membawa keadaan
 * yang dihitung dari data hari itu — "siap" yang tak pernah bisa berbunyi
 * "belum" hanya menyalin janji mockup ke layar.
 */

/** Cara sebuah masukan terisi. Daftar TERTUTUP. */
export const CARA = ["otomatis", "campuran", "input_keuangan"] as const;
export type Cara = (typeof CARA)[number];

export const LABEL_CARA: Record<Cara, string> = {
  otomatis: "Otomatis",
  campuran: "Otomatis + input",
  input_keuangan: "Input keuangan",
};

/** Keadaan satu masukan pada tanggal yang dilihat. */
export type KeadaanSumber = "siap" | "sebagian" | "belum" | "batas_diketahui";

export const LABEL_KEADAAN: Record<KeadaanSumber, string> = {
  siap: "Siap",
  sebagian: "Sebagian",
  belum: "Belum ada",
  batas_diketahui: "Ada, dengan batas",
};

export interface Masukan {
  /** Nama sheet di workbook — dipakai apa adanya supaya tim keuangan mengenalinya. */
  sheet: string;
  /** Sumbernya di SolaMax, dalam istilah yang bisa ditelusuri. */
  sumber: string;
  cara: Cara;
  keadaan: KeadaanSumber;
  /** Kalimat keadaan. Untuk `belum`/`sebagian`: sebut SIAPA yang mengisinya. */
  catatan: string;
  /** Dipakai bila keadaannya turunan dari sebab yang sudah dinamai. */
  sebab?: SebabKosong;
}

/** Fakta hidup yang dibutuhkan untuk menilai keadaan tiap masukan. */
export interface FaktaSumber {
  produk: number;
  produkBerhargaBeli: number;
  akunKas: number;
  adaOpname: boolean;
  adaPenjualan: boolean;
  barisBiayaPengawas: number;
  barisBiayaFinance: number;
  settlementHariIni: number;
  /** Produk yang `sisaSo`-nya tak terhitung — bahan batas B7. */
  produkTanpaSisaSo: number;
}

/**
 * Keempat belas masukan workbook, dinilai terhadap fakta hari itu.
 *
 * ⚠️ **DUA BATAS YANG KITA TAHU DISEBUT DI SINI, bukan disembunyikan.** Layar
 * sumber data yang tak menyebut apa yang belum cocok adalah layar sumber data
 * yang salah:
 *
 *   · `SisaSO` — nilainya masih memakai sumbu tanggal yang belum selaras, dan
 *     meleset pada **4 dari 10** tanggal uji emas (B7). Menyebutnya ≠
 *     memperbaikinya, dan perbaikannya bukan lingkup layar ini.
 *   · Saldo pembuka ekuitas (`Opened Retained Earnings`) **tak bersumber sama
 *     sekali** — ia hidup di workbook, jadi `BSCheck` kumulatif mustahil sampai
 *     impor riwayat dikerjakan. Itu sebabnya ada baris ke-15 di bawah yang
 *     TIDAK ada di daftar workbook: ketiadaan sumber pun adalah sumber
 *     informasi, dan ia hanya terlihat kalau ditulis sebagai baris.
 */
export function daftarMasukan(f: FaktaSumber): Masukan[] {
  const kurangHarga = Math.max(0, f.produk - f.produkBerhargaBeli);
  return [
    {
      sheet: "VolumePenjualan",
      sumber: "sales_detail per nozzle",
      cara: "otomatis",
      keadaan: f.adaPenjualan ? "siap" : "belum",
      catatan: f.adaPenjualan
        ? "Ditarik agent dari EasyMax."
        : "Belum ada baris penjualan untuk tanggal ini — tunggu sinkron agent.",
    },
    {
      sheet: "HargaJual",
      sumber: "sales_detail · harga per transaksi",
      cara: "otomatis",
      keadaan: f.adaPenjualan ? "siap" : "belum",
      catatan: f.adaPenjualan
        ? "Harga per transaksi — lebih teliti daripada harga bulanan di workbook."
        : "Ikut kosong selama belum ada penjualan hari ini.",
    },
    {
      sheet: "HargaBeli",
      sumber: "Faktur Pertamina — diketik di Input keuangan blok 1",
      cara: "input_keuangan",
      keadaan: f.produk === 0 ? "belum" : kurangHarga === 0 ? "siap" : "sebagian",
      catatan:
        kurangHarga === 0
          ? "Semua produk punya harga beli berlaku pada tanggal ini."
          : `${kurangHarga} dari ${f.produk} produk belum punya harga beli — tim keuangan, di Input keuangan blok 1.`,
      sebab: kurangHarga === 0 ? undefined : "belum_ada_harga_beli",
    },
    {
      sheet: "StockAkhirHari",
      sumber: "opname penutup per tangki",
      cara: "otomatis",
      keadaan: f.adaOpname ? "siap" : "belum",
      catatan: f.adaOpname
        ? "Opname penutup sudah masuk."
        : "Opname penutup hari ini belum masuk dari EasyMax.",
      sebab: f.adaOpname ? undefined : "belum_ada_opname",
    },
    {
      sheet: "LossesGain",
      sumber: "opname · metode RESUME operasional",
      cara: "otomatis",
      keadaan: f.adaOpname ? "siap" : "belum",
      catatan: f.adaOpname
        ? "Dihitung dari stok fisik vs teori — bukan dari nvolselisih buku EasyMax."
        : "Menunggu opname penutup.",
      sebab: f.adaOpname ? undefined : "belum_ada_opname",
    },
    {
      sheet: "PenebusanBBM",
      sumber: "tebus_header ⋈ tebus_detail",
      cara: "otomatis",
      keadaan: "siap",
      catatan: "Volumenya otomatis; nilainya mengikuti harga beli yang berlaku.",
    },
    {
      sheet: "SisaSO",
      sumber: "SO vs penerimaan per CNOSO",
      cara: "otomatis",
      // ⚠️ Batas B7 — bukan "siap".
      keadaan: "batas_diketahui",
      catatan:
        "Volumenya dipakai juga di Usulan Penebusan SO. ⚠️ NILAINYA masih memakai sumbu " +
        "tanggal yang belum selaras dan meleset pada 4 dari 10 tanggal uji emas (B7) — " +
        "jangan dipakai sebagai bukti sampai sumbunya diselaraskan." +
        (f.produkTanpaSisaSo > 0 ? ` ${f.produkTanpaSisaSo} produk tak terhitung hari ini.` : ""),
    },
    {
      sheet: "Tera",
      sumber: "terra_resmi",
      cara: "otomatis",
      keadaan: "siap",
      catatan: "⚠️ Konvensi satuan tera di EasyMax tidak seragam antar-unit; SolaMax mencerminkannya.",
    },
    {
      sheet: "PengambilanBBMPelangganEasyMax",
      sumber: "pelanggan_sale",
      cara: "otomatis",
      keadaan: "siap",
      catatan: "Menggantikan IMPORTRANGE antar-spreadsheet — tautan yang diam-diam kosong bila berkas sumbernya berpindah.",
    },
    {
      sheet: "BukuHutangPiutangPelangganEasyMax",
      sumber: "bppiut · bphut · tm_plg",
      cara: "otomatis",
      keadaan: "siap",
      catatan: "Terbukti eksak pada 24 sel di 2 unit; oracle-nya 'DAFTAR SALDO HUTANG PIUTANG'.",
    },
    {
      sheet: "BukuHutangPiutangNonEasyMax",
      sumber: "buku kas kategori `Hutang Piutang`",
      cara: "input_keuangan",
      keadaan: f.akunKas > 0 ? "siap" : "belum",
      catatan:
        f.akunKas > 0
          ? "Mengalir dari mutasi buku kas berkategori Hutang Piutang."
          : "Butuh daftar rekening kas/bank unit ini lebih dulu — tim keuangan yang mendaftarkannya.",
      sebab: f.akunKas > 0 ? undefined : "belum_ada_akun_kas",
    },
    {
      sheet: "BiayaOperasional",
      sumber: "Rincian Penjualan seksi pengeluaran + pintu Finance",
      cara: "campuran",
      keadaan: f.barisBiayaPengawas + f.barisBiayaFinance > 0 ? "siap" : "belum",
      catatan:
        f.barisBiayaPengawas + f.barisBiayaFinance > 0
          ? `${f.barisBiayaPengawas} baris dari pengawas · ${f.barisBiayaFinance} dari pintu Finance. Fakta milik pengawas; Finance mereklasifikasi tanpa menyentuhnya.`
          : "Belum ada baris biaya untuk tanggal ini — pengawas di Rincian Penjualan, atau Finance lewat pintunya sendiri.",
    },
    {
      sheet: "PendapatanLainLain",
      sumber: "Rincian Penjualan seksi pendapatan lain",
      cara: "campuran",
      keadaan: "siap",
      catatan: "Sama seperti biaya: milik pengawas, direklasifikasi Finance secara teraudit.",
    },
    {
      sheet: "BukuKasBesar & 5 buku bank & BukuEDC",
      sumber: "rekening koran + setoran per shift yang DITAWARKAN",
      cara: "input_keuangan",
      keadaan: f.akunKas === 0 ? "belum" : f.settlementHariIni > 0 ? "siap" : "sebagian",
      catatan:
        f.akunKas === 0
          ? "Unit ini belum punya daftar rekening — tim keuangan yang mendaftarkannya."
          : `${f.akunKas} akun terdaftar. Baris setoran ditawarkan terisi dari Rincian Penjualan; yang dilakukan Finance adalah menyetujui.`,
      sebab: f.akunKas === 0 ? "belum_ada_akun_kas" : undefined,
    },
    // ⚠️ BARIS KE-15 — TIDAK ADA di daftar workbook, dan justru itu sebabnya ia
    // ditulis: ketiadaan sumber adalah informasi, dan ia hanya terlihat kalau
    // punya baris sendiri.
    {
      sheet: "Saldo pembuka ekuitas (tak ada di workbook sebagai sheet)",
      sumber: "— belum ada",
      cara: "input_keuangan",
      keadaan: "belum",
      catatan:
        "Opened Retained Earnings hidup di workbook, bukan di SolaMax. Selama belum diimpor, " +
        "Equity dan Balance Sheet Check KUMULATIF mustahil disusun — yang bisa, dan yang dinilai " +
        "gerbang, adalah LANGKAH HARIAN-nya.",
      sebab: "belum_ada_saldo_pembuka",
    },
  ];
}

export interface RingkasSumber {
  total: number;
  perCara: Record<Cara, number>;
  belum: number;
  berbatas: number;
}

/**
 * Ringkasan kepala layar.
 *
 * `perCara` adalah `Record` atas union: menambah cara baru **menggagalkan
 * type-check** sampai ia ditangani — pola yang sama dengan `SUMBER_BEBAN`.
 */
export function ringkasSumber(m: readonly Masukan[]): RingkasSumber {
  const perCara = { otomatis: 0, campuran: 0, input_keuangan: 0 } satisfies Record<Cara, number>;
  for (const x of m) perCara[x.cara] += 1;
  return {
    total: m.length,
    perCara,
    belum: m.filter((x) => x.keadaan === "belum").length,
    berbatas: m.filter((x) => x.keadaan === "batas_diketahui").length,
  };
}
