/**
 * Impor rekening koran — bagian MURNI (rencana 2026-10-29 U9; R17–R19, R22;
 * KTD13). Tanpa I/O, tanpa DB: dipakai server action, kueri halaman, dan uji.
 */
import { bulanSah, geserBulan } from "./bulan";
import { periksaKaki, type Ketidakcocokan, type RekeningKoran } from "./impor-bank-parser";

/**
 * Batas ukuran berkas unggahan. E-statement nyata 30–75 KB; `bodySizeLimit`
 * server action (`next.config.mjs`) = "1mb" = 1.048.576 byte untuk SELURUH
 * badan multipart, jadi berkasnya dibatasi sedikit di bawahnya. Komponen unggah
 * memeriksanya SEBELUM mengirim — berkas lebih besar dari `bodySizeLimit`
 * ditolak Next sebelum aksi berjalan, dengan galat yang tak berpesan.
 */
export const MAKS_BERKAS_BYTE = 1_000_000;

/**
 * `null` = boleh dibaca; selainnya pesan penolakan untuk pengguna. `jenis`
 * "ai" = rekening koran bank lain (PDF/foto) untuk pembaca AI (U10).
 */
export function periksaBerkas(ukuran: number, jenis: "bca" | "ai" = "bca"): string | null {
  if (jenis === "ai") {
    if (ukuran <= 0) return "Berkas kosong — pilih PDF atau foto rekening koran.";
    if (ukuran > MAKS_BERKAS_BYTE) {
      return (
        `Berkas ${(ukuran / 1_000_000).toFixed(1).replace(".", ",")} MB melebihi batas 1 MB. ` +
        "Foto diperkecil otomatis di peramban; PDF yang lebih besar dari 1 MB pecah per halaman atau ketik barisnya manual."
      );
    }
    return null;
  }
  if (ukuran <= 0) return "Berkas kosong — pilih e-statement PDF dari BCA.";
  if (ukuran > MAKS_BERKAS_BYTE) {
    return (
      `Berkas ${(ukuran / 1_000_000).toFixed(1).replace(".", ",")} MB melebihi batas 1 MB. ` +
      "E-statement BCA satu bulan biasanya 30–75 KB — pastikan yang diunggah e-statement PDF dari BCA, bukan hasil pindai."
    );
  }
  return null;
}

/**
 * Digit saja, nol di depan dibuang (KTD13). Kepala e-statement mencetak 10
 * digit ("5125036811"); sumber lain bisa berawalan nol ("05125036811").
 */
export function normalisasiNomorRekening(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Kosong / nol semua TIDAK PERNAH sama dengan apa pun — fail-closed. */
export function nomorRekeningSama(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalisasiNomorRekening(a);
  return x !== "" && x === normalisasiNomorRekening(b);
}

/** `YYYY-MM` ⇒ `YYYY-MM-01`. */
export function periodeAwal(periode: string): string {
  if (!bulanSah(periode)) throw new Error(`Periode harus YYYY-MM, diterima "${periode}".`);
  return `${periode}-01`;
}

/** Bulan `awal`..`akhir` inklusif (`YYYY-MM`); kosong bila awal > akhir. */
export function daftarBulan(awal: string, akhir: string): string[] {
  periodeAwal(awal);
  periodeAwal(akhir);
  const hasil: string[] = [];
  let [y, m] = awal.split("-").map(Number) as [number, number];
  const [ya, ma] = akhir.split("-").map(Number) as [number, number];
  while (y < ya || (y === ya && m <= ma)) {
    hasil.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// R18 — saldo awal rekening koran vs saldo buku hari sebelum periode
// ---------------------------------------------------------------------------

/**
 * Saldo buku rekening itu pada AWAL hari pertama periode — dihitung MENURUT
 * TANGGAL ASAL (baris bulan lalu yang dibukukan maju dihitung pada tanggal
 * asalnya), dari saldo pembuka rekening (`saldo_awal`, §10.24). Lihat
 * `SQL_SALDO_BUKU_AWAL` di `impor-bank-queries.ts`.
 */
export interface SaldoBukuAwal {
  /** Hari saldo pembuka rekening (saldo berlaku pada AWAL hari ini). */
  cutOver: string;
  saldoSen: number;
  /** §10.26 — saldo pembuka rekening masih sementara. */
  sementara: boolean;
}

export type PerbandinganSaldoAwal =
  | { status: "cocok" | "selisih"; bukuSen: number; /** rekening koran − buku */ selisihSen: number; sementara: boolean }
  /** Rekening belum punya saldo pembuka — tak ada buku untuk dibandingkan. */
  | { status: "tanpa-saldo-pembuka" }
  /** Periode dimulai sebelum saldo pembuka rekening (R22) — buku belum ada. */
  | { status: "sebelum-cut-over"; cutOver: string };

export function bandingkanSaldoAwal(m: {
  periode: string;
  saldoAwalSen: number;
  buku: SaldoBukuAwal | null;
  /**
   * Cut-over terawal UNIT (§10.26) — dipakai hanya bila rekening belum punya
   * saldo pembuka sendiri, supaya hasil ini sejalan dengan kepala baris matriks
   * dan penanda `pra_cutover` (keduanya jatuh ke cut-over unit, `SQL_CUT_OVER`).
   */
  cutOverUnit?: string | null;
}): PerbandinganSaldoAwal {
  if (m.buku === null) {
    if (m.cutOverUnit && m.cutOverUnit > periodeAwal(m.periode)) return { status: "sebelum-cut-over", cutOver: m.cutOverUnit };
    return { status: "tanpa-saldo-pembuka" };
  }
  if (m.buku.cutOver > periodeAwal(m.periode)) return { status: "sebelum-cut-over", cutOver: m.buku.cutOver };
  const selisihSen = m.saldoAwalSen - m.buku.saldoSen;
  return { status: selisihSen === 0 ? "cocok" : "selisih", bukuSen: m.buku.saldoSen, selisihSen, sementara: m.buku.sementara };
}

// ---------------------------------------------------------------------------
// Hasil unggah — empat keluaran yang dibedakan layar (U9 butir 6)
// ---------------------------------------------------------------------------

export type SebabTolak =
  /** Bukan peran Keuangan (atau HoF, §10.12). */
  | "wewenang"
  /** Kosong, terlalu besar, bukan PDF, pdftotext gagal. */
  | "berkas"
  /** Teks bukan e-statement BCA yang dikenali (U8 `format`). */
  | "format"
  /** R18 — rekening tak terdaftar di unit ini / nomor tak cocok / bukan BCA. */
  | "rekening-salah"
  /** Berkas BERBEDA untuk (rekening, bulan) yang sudah aktif — HoF menarik dulu. */
  | "periode-aktif"
  /** Bulan berkas sudah ditutup (`tutup_bulan`) — tak dibuka kembali (§10.43). */
  | "bulan-tertutup"
  /** Galat tak terduga saat menulis — transaksi dibatalkan, tak ada yang tersimpan. */
  | "galat";

export type HasilCocokSesudahUnggah =
  | { status: "selesai"; nOtomatis: number; nBanyak: number; nTanpa: number }
  | { status: "gagal"; pesan: string };

export type HasilUnggah =
  | {
      status: "diterima";
      rekeningKoranId: string;
      periode: string;
      nBaris: number;
      /** R22 — baris bertanggal sebelum cut-over: disimpan, tak pernah dibukukan. */
      nPraCutover: number;
      nCr: number;
      nDb: number;
      saldoAwal: PerbandinganSaldoAwal;
      /**
       * U10 — cocok otomatis yang dijalankan SESUDAH impor COMMIT. Gagalnya tak
       * membatalkan impor (baris tetap tersimpan, terbuka); pesannya dilaporkan.
       */
      cocok: HasilCocokSesudahUnggah;
    }
  | { status: "sudah-ada"; rekeningKoranId: string; periode: string; nBaris: number; nPraCutover: number }
  | { status: "ditolak-kaki"; pesan: string; ketidakcocokan: Ketidakcocokan[] }
  | { status: "ditolak"; sebab: SebabTolak; pesan: string };

// ---------------------------------------------------------------------------
// Sel matriks rekening × bulan
// ---------------------------------------------------------------------------

export interface RingkasRekeningKoran {
  id: string;
  status: "aktif" | "ditarik";
  nBaris: number;
  nPraCutover: number;
  /** Baris (bukan pra-cut-over) yang berada di kelompok cocok AKTIF (U10). */
  nCocok: number;
  uploadedAt: string;
}

export type SelMatriks =
  | { status: "belum" }
  /**
   * `nTerbuka` = baris yang belum di kelompok cocok AKTIF dan bukan pra-cut-over
   * (pra-cut-over tak pernah dicocokkan, R22): N − pra-cut-over − tercocok.
   */
  | { status: "diunggah"; id: string; nBaris: number; nTerbuka: number }
  | { status: "ditarik"; id: string };

/** Rekening koran satu (rekening, bulan) — paling banyak satu yang aktif (0051). */
export function selMatriks(rows: readonly RingkasRekeningKoran[]): SelMatriks {
  const aktif = rows.find((r) => r.status === "aktif");
  if (aktif) return { status: "diunggah", id: aktif.id, nBaris: aktif.nBaris, nTerbuka: aktif.nBaris - aktif.nPraCutover - aktif.nCocok };
  const terakhir = [...rows].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  return terakhir ? { status: "ditarik", id: terakhir.id } : { status: "belum" };
}

// ---------------------------------------------------------------------------
// Pembaca AI & input manual rekening koran bank lain (rencana 2026-11-02 U10;
// R29, R30, AE8, KTD9). MURNI — dipakai aksi, komponen, dan uji. Klien
// Anthropic hidup di `rekening-koran-ai.ts` (tidak boleh masuk bundel peramban).
// ---------------------------------------------------------------------------

/**
 * Empat angka kontrol yang DIKETIK staf Keuangan dari cetakan rekening koran
 * (R30). Sen bulat. Debet = uang keluar, kredit = uang masuk (sudut pandang
 * bank, sama dengan DB/CR e-statement BCA).
 */
export interface AngkaKontrol {
  saldoAwalSen: number;
  totalDebetSen: number;
  totalKreditSen: number;
  saldoAkhirSen: number;
}

const RE_RUPIAH_KETIK = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Angka ketikan gaya Indonesia → sen: "10.000.000", "1.234.567,89", "250000,5".
 * Titik = pemisah ribuan, koma = desimal. Bentuk lain (mis. "1,234.56") DITOLAK
 * (`null`), tidak ditebak — salah tebak ribuan/desimal = selisih 100×.
 * Bukan `bacaRupiah` (angka-input.ts): itu menolak sen, sedangkan rekening
 * koran mencetak sen (bunga, biaya admin) dan gerbangnya bertoleransi Rp 0.
 */
export function parseRupiahKetik(teks: string): number | null {
  const m = RE_RUPIAH_KETIK.exec(teks.trim().replace(/^Rp\s*/i, ""));
  if (!m) return null;
  const sen = Number(m[2]!.replace(/\./g, "")) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(sen)) return null;
  return m[1] ? -sen : sen;
}

/** Kebalikan {@link parseRupiahKetik}: 123456789 → "1.234.567,89". */
export function formatRupiahKetik(sen: number): string {
  const a = Math.abs(sen);
  const utuh = Math.floor(a / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sisa = a % 100;
  return `${sen < 0 ? "-" : ""}${utuh}${sisa === 0 ? "" : `,${String(sisa).padStart(2, "0")}`}`;
}

/** `null` = empat angka kontrol menutup; selainnya pesan untuk pengguna. */
export function periksaAngkaKontrol(k: AngkaKontrol): string | null {
  if (k.totalDebetSen < 0 || k.totalKreditSen < 0) return "Total debet dan total kredit tidak boleh negatif.";
  const hitung = k.saldoAwalSen + k.totalKreditSen - k.totalDebetSen;
  if (hitung !== k.saldoAkhirSen) {
    return (
      `Angka kontrol tidak menutup: saldo awal + total kredit − total debet = ${rpBertanda(hitung)}, ` +
      `sedangkan saldo akhir yang diketik ${rpBertanda(k.saldoAkhirSen)}. Periksa ketikan dari cetakan rekening koran.`
    );
  }
  return null;
}

/**
 * Pembanding saldo awal (R30):
 *   · `rekening-koran-lalu` — saldo akhir rekening koran TERKONFIRMASI bulan
 *     tepat sebelumnya;
 *   · `bulan-lalu-belum` — ada rekening koran terkonfirmasi yang lebih awal,
 *     tetapi bulan tepat sebelumnya belum: tak ada jangkar, tolak;
 *   · `buku-bank` — rekening yang belum pernah punya rekening koran
 *     terkonfirmasi: saldo buku bank (`bandingkanSaldoAwal`, jangkar pertama).
 */
export type Jangkar =
  | { jenis: "rekening-koran-lalu"; periode: string; saldoAkhirSen: number }
  | { jenis: "bulan-lalu-belum"; periodeLalu: string }
  | { jenis: "buku-bank"; perbandingan: PerbandinganSaldoAwal };

export type AngkaKontrolNama = "saldo-awal" | "total-debet" | "total-kredit" | "saldo-akhir";

export type Pelanggaran =
  | { jenis: "kontrol"; angka: AngkaKontrolNama; terbaca: number; kontrol: number; selisih: number }
  /** `baris` 1.. sesuai urutan cetak. */
  | { jenis: "saldo-berjalan"; baris: number; tanggal: string; dihitung: number; tercetak: number }
  | { jenis: "tanggal"; baris: number; tanggal: string; alasan: "mundur" | "di-luar-periode" }
  | { jenis: "jangkar"; sumber: "rekening-koran-lalu" | "buku-bank"; saldoAwal: number; jangkarSen: number; selisih: number }
  | { jenis: "tanpa-jangkar"; pesan: string };

const ANGKA_DARI_KAKI: Partial<Record<Ketidakcocokan["pemeriksaan"], AngkaKontrolNama>> = {
  "saldo-awal": "saldo-awal",
  "mutasi-db": "total-debet",
  "mutasi-cr": "total-kredit",
  "saldo-akhir": "saldo-akhir",
};

/** Saldo awal vs jangkar — dipakai gerbang bacaan DAN konfirmasi HoF. */
export function periksaJangkar(saldoAwalSen: number, jangkar: Jangkar): Pelanggaran | null {
  if (jangkar.jenis === "rekening-koran-lalu") {
    const selisih = saldoAwalSen - jangkar.saldoAkhirSen;
    return selisih === 0
      ? null
      : { jenis: "jangkar", sumber: "rekening-koran-lalu", saldoAwal: saldoAwalSen, jangkarSen: jangkar.saldoAkhirSen, selisih };
  }
  if (jangkar.jenis === "bulan-lalu-belum") {
    return {
      jenis: "tanpa-jangkar",
      pesan: `Rekening koran ${jangkar.periodeLalu} untuk rekening ini belum dikonfirmasi — unggah dan minta Head of Finance mengonfirmasinya dulu.`,
    };
  }
  const p = jangkar.perbandingan;
  if (p.status === "tanpa-saldo-pembuka") {
    return {
      jenis: "tanpa-jangkar",
      pesan:
        "Rekening ini belum punya saldo pembuka di buku, jadi saldo awal rekening koran tidak bisa dibandingkan — Head of Finance mengisinya di Kelola akun kas.",
    };
  }
  if (p.status === "sebelum-cut-over") {
    return {
      jenis: "tanpa-jangkar",
      pesan: `Periode ini dimulai sebelum saldo pembuka rekening (${p.cutOver}) — saldo awal tidak bisa dibandingkan dengan buku.`,
    };
  }
  if (p.status === "cocok") return null;
  return { jenis: "jangkar", sumber: "buku-bank", saldoAwal: saldoAwalSen, jangkarSen: p.bukuSen, selisih: p.selisihSen };
}

export type HasilGerbang =
  /** `rk.footer` = angka kontrol (jumlah baris dihitung dari bacaan). */
  | { ok: true; rk: RekeningKoran }
  | { ok: false; pelanggaran: Pelanggaran[]; pesan: string };

/**
 * Gerbang R30 — sama untuk bacaan AI dan baris yang diketik manual. Lolos
 * HANYA bila: Σ debet, Σ kredit, saldo awal, saldo akhir hasil baca = empat
 * angka kontrol persis (`periksaKaki`, toleransi Rp 0); setiap saldo berjalan
 * yang tercetak = saldo sebelumnya ± nominal; tanggal tidak mundur dan berada
 * di dalam periode; saldo awal = jangkar. Satu pelanggaran = tolak utuh.
 */
export function periksaBacaan(m: { rk: RekeningKoran; kontrol: AngkaKontrol; periode: string; jangkar: Jangkar }): HasilGerbang {
  const { kontrol } = m;
  const nCr = m.rk.rows.filter((r) => r.amountSen >= 0).length;
  const rk: RekeningKoran = {
    ...m.rk,
    periode: m.periode,
    footer: {
      mutasiCrSen: kontrol.totalKreditSen,
      nCr,
      mutasiDbSen: kontrol.totalDebetSen,
      nDb: m.rk.rows.length - nCr,
      saldoAkhirSen: kontrol.saldoAkhirSen,
    },
  };
  const pelanggaran: Pelanggaran[] = [];
  for (const k of periksaKaki(rk, kontrol.saldoAwalSen)) {
    const angka = ANGKA_DARI_KAKI[k.pemeriksaan];
    if (angka) pelanggaran.push({ jenis: "kontrol", angka, terbaca: k.terbaca, kontrol: k.kaki, selisih: k.selisih });
  }
  let saldo = rk.saldoAwalSen;
  let tanggalLalu = "";
  rk.rows.forEach((r, i) => {
    saldo += r.amountSen;
    if (r.saldoSen !== null && r.saldoSen !== saldo) {
      // Saldo hitungan TIDAK diganti angka tercetak: salah baca satu saldo =
      // satu pelanggaran; baris terlewat = setiap saldo sesudahnya berselisih.
      pelanggaran.push({ jenis: "saldo-berjalan", baris: i + 1, tanggal: r.tanggal, dihitung: saldo, tercetak: r.saldoSen });
    }
    if (r.tanggal.slice(0, 7) !== m.periode) {
      pelanggaran.push({ jenis: "tanggal", baris: i + 1, tanggal: r.tanggal, alasan: "di-luar-periode" });
    } else if (r.tanggal < tanggalLalu) {
      pelanggaran.push({ jenis: "tanggal", baris: i + 1, tanggal: r.tanggal, alasan: "mundur" });
    }
    if (r.tanggal > tanggalLalu) tanggalLalu = r.tanggal;
  });
  const j = periksaJangkar(rk.saldoAwalSen, m.jangkar);
  if (j) pelanggaran.push(j);
  return pelanggaran.length === 0 ? { ok: true, rk } : { ok: false, pelanggaran, pesan: pesanPelanggaran(pelanggaran) };
}

function rpBertanda(sen: number): string {
  const a = Math.abs(sen);
  const utuh = Math.floor(a / 100).toLocaleString("id-ID");
  const sisa = a % 100;
  return `${sen < 0 ? "−" : ""}Rp ${utuh}${sisa === 0 ? "" : `,${String(sisa).padStart(2, "0")}`}`;
}

export const LABEL_ANGKA_KONTROL: Record<AngkaKontrolNama, string> = {
  "saldo-awal": "Saldo awal",
  "total-debet": "Total debet",
  "total-kredit": "Total kredit",
  "saldo-akhir": "Saldo akhir",
};

/** Kalimat penolakan — menyebut setiap angka yang berbeda (AE8). */
export function pesanPelanggaran(p: readonly Pelanggaran[]): string {
  const rinci = p.map((x) => {
    switch (x.jenis) {
      case "kontrol":
        return `${LABEL_ANGKA_KONTROL[x.angka]}: terbaca ${rpBertanda(x.terbaca)}, angka kontrol ${rpBertanda(x.kontrol)} (selisih ${rpBertanda(x.selisih)})`;
      case "saldo-berjalan":
        return `baris ${x.baris} (${x.tanggal}): saldo tercetak ${rpBertanda(x.tercetak)}, saldo sebelumnya ± nominal = ${rpBertanda(x.dihitung)}`;
      case "tanggal":
        return x.alasan === "mundur" ? `baris ${x.baris}: tanggal ${x.tanggal} mundur dari baris sebelumnya` : `baris ${x.baris}: tanggal ${x.tanggal} di luar periode`;
      case "jangkar":
        return `${x.sumber === "buku-bank" ? "Saldo awal vs saldo buku bank" : "Saldo awal vs saldo akhir rekening koran bulan lalu"}: ${rpBertanda(x.saldoAwal)} vs ${rpBertanda(x.jangkarSen)} (selisih ${rpBertanda(x.selisih)})`;
      case "tanpa-jangkar":
        return x.pesan;
    }
  });
  return `Bacaan ditolak — tidak ada baris yang disimpan. ${rinci.join("; ")}.`;
}

/** Bulan tepat sebelum `periode` (`YYYY-MM`). */
export function bulanSebelum(periode: string): string {
  return geserBulan(periode, -1);
}

/** Batas pembacaan AI per rekening per bulan kalender WIB, yang ditolak ikut dihitung (KTD9). */
export const BATAS_BACA_AI_PER_BULAN = 10;

/**
 * Perkecil & kodekan ulang foto sampai ≤ `batas` byte (U10). `kodekan(lebar,
 * mutu)` = pengode JPEG peramban (kanvas) — disuntikkan supaya jadwalnya bisa
 * diuji tanpa peramban. Lebar ≥ 1200 px supaya angka kecil tetap terbaca;
 * yang tetap tak muat ditolak dengan pesan, tidak dikirim.
 */
export async function perkecilSampaiMuat<T extends { size: number }>(
  kodekan: (lebarMaks: number, mutu: number) => Promise<T>,
  batas: number = MAKS_BERKAS_BYTE,
): Promise<{ ok: true; hasil: T } | { ok: false; pesan: string }> {
  for (const lebar of [2400, 2000, 1600, 1200]) {
    for (const mutu of [0.85, 0.7, 0.55]) {
      const hasil = await kodekan(lebar, mutu);
      if (hasil.size <= batas) return { ok: true, hasil };
    }
  }
  return {
    ok: false,
    pesan:
      "Foto tetap di atas 1 MB setelah diperkecil — potong foto per halaman rekening koran, atau ketik barisnya manual.",
  };
}

export type SebabTolakAi =
  | "wewenang"
  | "rekening-salah"
  | "berkas"
  | "kontrol"
  /** ANTHROPIC_API_KEY tidak ada — fitur menolak, input manual ditawarkan. */
  | "tanpa-kunci"
  /** Model menolak (`refusal`), bukan rekening koran, atau bacaan cacat. */
  | "tidak-terbaca"
  /** Layanan AI tak terjangkau / kunci ditolak / sibuk. */
  | "layanan"
  | "batas-percobaan"
  | "periode-aktif"
  | "bulan-tertutup"
  | "galat";

export type HasilBacaRekeningKoran =
  | { status: "menunggu-konfirmasi"; rekeningKoranId: string; periode: string; nBaris: number; sisaPercobaan: number | null }
  | { status: "ditolak-gerbang"; pesan: string; pelanggaran: Pelanggaran[]; sisaPercobaan: number | null }
  | { status: "ditolak"; sebab: SebabTolakAi; pesan: string; inputManual: boolean; sisaPercobaan: number | null };
