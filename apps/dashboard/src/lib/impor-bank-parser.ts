/**
 * Pembaca e-statement BCA "REKENING GIRO" — teks keluaran `pdftotext -layout`
 * (lihat `pdf-teks.ts`) menjadi kepala, baris mutasi, dan kaki (U8, KTD10).
 *
 * Port dari `parse_rk.py` yang terbukti 18/18 pada berkas nyata. Murni: tanpa
 * I/O, tanpa DB.
 *
 * ⛔ **Uang = sen bulat (`number` yang dijamin safe integer), tidak pernah
 * float.** `"1,234,567.89"` dibaca lewat operasi string. Nominal terbesar di
 * rekening koran unit ±Rp 10¹² = 10¹⁴ sen, jauh di bawah 2⁵³.
 *
 * ⛔ **Tolak UTUH, tidak ada "terima sebagian" (R17, AE3).** Σ CR, Σ DB, jumlah
 * mutasi CR/DB, dan saldo awal + CR − DB harus sama persis dengan kaki rekening
 * koran. Selisih Rp 0,01 pun menolak seluruh berkas — format BCA yang berubah
 * harus gagal BERSUARA, bukan senyap.
 *
 * Tata letak (kolom dari `pdftotext -layout`):
 *   · baris mutasi diawali `DD/MM` berindentasi 4–8 spasi; nominal di ujung
 *     kanan, ditandai ` DB` bila debit, saldo berjalan opsional sesudahnya;
 *   · keterangan lanjutan berindentasi ≥ 20 (kolom keterangan 21 / 49);
 *   · kepala halaman ("REKENING GIRO", "KCP", "HALAMAN", "CATATAN", kepala
 *     kolom, "Bersambung ke halaman berikut") dan kaki menghentikan baris;
 *   · huruf kepala dipecah spasi oleh PDF-nya: "PE RIOD E : SE PTE MBE R 2026",
 *     "NO. RE KE NING : 9 876 54 3210" — dicocokkan sesudah spasi dibuang.
 */

export type BarisRekeningKoran = {
  /** Tanggal ISO `YYYY-MM-DD` — tahun dari periode kepala. */
  tanggal: string;
  /** Urutan 1.. di dalam tanggal yang sama, sesuai urutan cetak. */
  urutan: number;
  /** Baris-baris keterangan, kolom dipisah " | ", baris dipisah " / ". */
  keterangan: string;
  /** Sen bertanda: CR positif, DB negatif. */
  amountSen: number;
  /** Saldo berjalan bila dicetak di baris itu. */
  saldoSen: number | null;
  /** Nomor SO penebusan B2B Pertamina (KTD7), bila ada. */
  so: string | null;
  /** Nomor dokumen sesudah "KURANG BAYAR" (KTD7), bila ada. */
  dokRef: string | null;
};

export type KakiRekeningKoran = {
  mutasiCrSen: number;
  nCr: number;
  mutasiDbSen: number;
  nDb: number;
  saldoAkhirSen: number;
};

export type RekeningKoran = {
  /** Digit saja dari kepala: "9 876 54 3210" ⇒ "9876543210". */
  nomorRekening: string;
  /** `YYYY-MM`. */
  periode: string;
  /** Dari baris "SALDO AWAL" di atas mutasi pertama. */
  saldoAwalSen: number;
  rows: BarisRekeningKoran[];
  footer: KakiRekeningKoran;
};

export type Pemeriksaan = "mutasi-cr" | "jumlah-cr" | "mutasi-db" | "jumlah-db" | "saldo-awal" | "saldo-akhir";

export type Ketidakcocokan = {
  pemeriksaan: Pemeriksaan;
  /** Nilai hasil baca (sen, atau jumlah baris untuk `jumlah-*`). */
  terbaca: number;
  /** Nilai yang tercetak di kaki rekening koran. */
  kaki: number;
  /** terbaca − kaki. */
  selisih: number;
};

/**
 * `kode: "format"` — teks bukan e-statement BCA yang dikenali (pesan menyebut
 * bagian yang tak ditemukan); `kode: "kaki-tidak-cocok"` — terbaca, tetapi
 * hasilnya tidak sama dengan kaki (`ketidakcocokan` merinci tiap pemeriksaan).
 */
export class GalatRekeningKoran extends Error {
  constructor(
    readonly kode: "format" | "kaki-tidak-cocok",
    message: string,
    readonly ketidakcocokan: Ketidakcocokan[] = [],
  ) {
    super(message);
    this.name = "GalatRekeningKoran";
  }
}

const galatFormat = (rincian: string) =>
  new GalatRekeningKoran("format", `Berkas bukan e-statement BCA yang dikenali: ${rincian}.`);

const NOMINAL = String.raw`\d{1,3}(?:,\d{3})*\.\d{2}`;

/** "1,234,567.89" ⇒ 123456789 (sen). Bentuk lain ditolak, tidak ditebak. */
export function parseSen(teks: string): number {
  if (!new RegExp(`^${NOMINAL}$`).test(teks)) throw galatFormat(`nominal "${teks}" tak terbaca`);
  const [utuh, sen] = teks.replace(/,/g, "").split(".");
  const nilai = Number(utuh) * 100 + Number(sen);
  if (!Number.isSafeInteger(nilai)) throw galatFormat(`nominal "${teks}" terlalu besar`);
  return nilai;
}

const BULAN: Record<string, string> = {
  JANUARI: "01",
  FEBRUARI: "02",
  MARET: "03",
  APRIL: "04",
  MEI: "05",
  JUNI: "06",
  JULI: "07",
  AGUSTUS: "08",
  SEPTEMBER: "09",
  OKTOBER: "10",
  NOVEMBER: "11",
  DESEMBER: "12",
};

const RE_MULAI = /^\s{4,8}(\d{2})\/(\d{2})\s{3,}(\S.*)$/;
const RE_NOMINAL_EKOR = new RegExp(`\\s(${NOMINAL})( DB)?(?:\\s+(${NOMINAL}))?\\s*$`);
const RE_KAKI = new RegExp(`^(SALDO AWAL|MUTASI CR|MUTASI DB|SALDO AKHIR)\\s*:\\s*(${NOMINAL})(?:\\s+(\\d+))?\\s*$`);
const RE_SO = /^H0000\d{6}(\d{7})$/;
const RE_SO_LANJUT = /^(\d{3})\d{8}$/;

/** Teks berspasi-ganda dirapatkan: kolom dipisah " | ". */
const rapikan = (s: string) => s.trim().replace(/\s{2,}/g, " | ");
/** Kepala BCA memecah huruf dengan spasi — cocokkan tanpa spasi. */
const rapat = (s: string) => s.replace(/\s+/g, "");

/** Baris kepala/penghenti halaman — tidak pernah milik keterangan mutasi. */
function kepalaHalaman(baris: string): boolean {
  const r = rapat(baris);
  return (
    baris.includes("Bersambung ke halaman") ||
    r.includes("REKENINGGIRO") ||
    /^\s{0,6}KCP\s/.test(baris) ||
    r.includes("NO.REKENING:") ||
    r.includes("HALAMAN:") ||
    r.includes("PERIODE:") ||
    r.includes("MATAUANG:") ||
    r.startsWith("CATATAN:") ||
    r.includes("TANGGALKETERANGAN")
  );
}

type BarisMentah = { dd: string; mm: string; teks: string[]; amountSen: number; saldoSen: number | null };

function ekstrakSo(teks: string[]): string | null {
  const token = teks.flatMap((t) => t.split(/[\s|/]+/)).filter(Boolean);
  for (let i = 0; i + 1 < token.length; i++) {
    const a = RE_SO.exec(token[i] ?? "");
    const b = a ? RE_SO_LANJUT.exec(token[i + 1] ?? "") : null;
    if (a && b) return `${a[1]}${b[1]}`;
  }
  return null;
}

function ekstrakDokRef(teks: string[]): string | null {
  const i = teks.findIndex((t) => t.includes("KURANG BAYAR"));
  const sesudah = i < 0 ? undefined : teks[i + 1];
  return sesudah?.split(/[\s|]+/).find(Boolean) ?? null;
}

const rp = (sen: number) => {
  const neg = sen < 0;
  const a = Math.abs(sen);
  const utuh = Math.floor(a / 100).toLocaleString("id-ID");
  return `${neg ? "-" : ""}Rp ${utuh},${String(a % 100).padStart(2, "0")}`;
};

const LABEL: Record<Pemeriksaan, string> = {
  "mutasi-cr": "MUTASI CR",
  "jumlah-cr": "jumlah mutasi CR",
  "mutasi-db": "MUTASI DB",
  "jumlah-db": "jumlah mutasi DB",
  "saldo-awal": "SALDO AWAL",
  "saldo-akhir": "SALDO AKHIR (saldo awal + CR − DB)",
};

/**
 * Baca teks `pdftotext -layout` satu e-statement BCA. Melempar
 * `GalatRekeningKoran` — tidak pernah mengembalikan hasil yang tak cocok kaki.
 */
export function bacaRekeningKoranBca(teks: string): RekeningKoran {
  const semua = teks.split(/\r?\n/);
  if (!semua.some((b) => rapat(b) === "REKENINGGIRO")) throw galatFormat('judul "REKENING GIRO" tidak ditemukan');

  let nomorRekening: string | null = null;
  let periode: string | null = null;
  const kaki: Partial<Record<"SALDO AWAL" | "MUTASI CR" | "MUTASI DB" | "SALDO AKHIR", { sen: number; n: number | null }>> = {};
  let saldoAwalSen: number | null = null;
  const mentah: BarisMentah[] = [];
  let cur: BarisMentah | null = null;
  const tutup = () => {
    if (cur) mentah.push(cur);
    cur = null;
  };

  for (const baris of semua) {
    const r = rapat(baris);
    if (r.includes("NO.REKENING:")) {
      const digit = r.split("NO.REKENING:")[1]!.replace(/\D/g, "");
      if (!digit) throw galatFormat("nomor rekening di kepala kosong");
      if (nomorRekening && nomorRekening !== digit) throw galatFormat("nomor rekening berbeda antar halaman");
      nomorRekening = digit;
    }
    if (r.includes("PERIODE:")) {
      const m = /PERIODE:([A-Z]+)(\d{4})$/.exec(r);
      const bulan = m ? BULAN[m[1]!] : undefined;
      if (!m || !bulan) throw galatFormat(`periode "${baris.trim()}" tak terbaca`);
      const p = `${m[2]}-${bulan}`;
      if (periode && periode !== p) throw galatFormat("periode berbeda antar halaman");
      periode = p;
    }
    if (kepalaHalaman(baris)) {
      tutup();
      continue;
    }
    const k = RE_KAKI.exec(baris.trim());
    if (k) {
      // Kaki di ujung berkas — "SALDO AWAL :" kaki jatuh persis sesudah baris
      // mutasi terakhir (rekening EDC) dan TIDAK boleh ikut keterangannya.
      tutup();
      const label = k[1] as keyof typeof kaki;
      if (kaki[label]) throw galatFormat(`kaki "${label}" tercetak dua kali`);
      kaki[label] = { sen: parseSen(k[2]!), n: k[3] === undefined ? null : Number(k[3]) };
      continue;
    }
    const m = RE_MULAI.exec(baris);
    if (m) {
      tutup();
      const dd = m[1]!;
      const mm = m[2]!;
      const isi = m[3]!;
      const a = RE_NOMINAL_EKOR.exec(isi);
      if (!a) throw galatFormat(`baris ${dd}/${mm} tanpa nominal: "${rapikan(isi)}"`);
      const ket = rapikan(isi.slice(0, a.index));
      if (ket === "SALDO AWAL") {
        if (saldoAwalSen !== null || mentah.length > 0) throw galatFormat('baris "SALDO AWAL" tidak di awal');
        if (a[2] || a[3]) throw galatFormat('baris "SALDO AWAL" berbentuk tak dikenal');
        saldoAwalSen = parseSen(a[1]!);
        continue;
      }
      const sen = parseSen(a[1]!);
      cur = { dd, mm, teks: [ket], amountSen: a[2] ? -sen : sen, saldoSen: a[3] ? parseSen(a[3]) : null };
      continue;
    }
    if (!baris.trim()) continue;
    if (cur && baris.length - baris.trimStart().length >= 20) {
      (cur as BarisMentah).teks.push(rapikan(baris));
    } else {
      tutup();
    }
  }
  tutup();

  if (!nomorRekening) throw galatFormat('"NO. REKENING" tidak ditemukan di kepala');
  if (!periode) throw galatFormat('"PERIODE" tidak ditemukan di kepala');
  if (saldoAwalSen === null) throw galatFormat('baris "SALDO AWAL" tidak ditemukan');
  const { "MUTASI CR": cr, "MUTASI DB": db, "SALDO AKHIR": akhir, "SALDO AWAL": awalKaki } = kaki;
  if (!cr || !db || !akhir || !awalKaki || cr.n === null || db.n === null) {
    throw galatFormat("kaki (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR) tidak lengkap — halaman terakhir terpotong?");
  }

  const tahun = periode.slice(0, 4);
  const bulan = periode.slice(5, 7);
  const perTanggal = new Map<string, number>();
  const rows: BarisRekeningKoran[] = mentah.map((b) => {
    if (b.mm !== bulan) throw galatFormat(`baris ${b.dd}/${b.mm} di luar periode ${periode}`);
    const tanggal = `${tahun}-${b.mm}-${b.dd}`;
    const urutan = (perTanggal.get(tanggal) ?? 0) + 1;
    perTanggal.set(tanggal, urutan);
    return {
      tanggal,
      urutan,
      keterangan: b.teks.join(" / "),
      amountSen: b.amountSen,
      saldoSen: b.saldoSen,
      so: ekstrakSo(b.teks),
      dokRef: ekstrakDokRef(b.teks),
    };
  });

  const footer: KakiRekeningKoran = {
    mutasiCrSen: cr.sen,
    nCr: cr.n,
    mutasiDbSen: db.sen,
    nDb: db.n,
    saldoAkhirSen: akhir.sen,
  };
  const crRows = rows.filter((r) => r.amountSen >= 0);
  const dbRows = rows.filter((r) => r.amountSen < 0);
  const sumCr = crRows.reduce((s, r) => s + r.amountSen, 0);
  const sumDb = -dbRows.reduce((s, r) => s + r.amountSen, 0);
  const cek: Array<[Pemeriksaan, number, number]> = [
    ["mutasi-cr", sumCr, footer.mutasiCrSen],
    ["jumlah-cr", crRows.length, footer.nCr],
    ["mutasi-db", sumDb, footer.mutasiDbSen],
    ["jumlah-db", dbRows.length, footer.nDb],
    ["saldo-awal", saldoAwalSen, awalKaki.sen],
    ["saldo-akhir", saldoAwalSen + sumCr - sumDb, footer.saldoAkhirSen],
  ];
  const ketidakcocokan = cek
    .filter(([, t, k]) => t !== k)
    .map(([pemeriksaan, terbaca, k]) => ({ pemeriksaan, terbaca, kaki: k, selisih: terbaca - k }));
  if (ketidakcocokan.length > 0) {
    const rinci = ketidakcocokan
      .map(({ pemeriksaan: p, terbaca: t, kaki: k, selisih: s }) =>
        p.startsWith("jumlah")
          ? `${LABEL[p]}: terbaca ${t}, kaki ${k} (selisih ${s})`
          : `${LABEL[p]}: terbaca ${rp(t)}, kaki ${rp(k)} (selisih ${rp(s)})`,
      )
      .join("; ");
    throw new GalatRekeningKoran(
      "kaki-tidak-cocok",
      `Rekening koran ditolak utuh — kaki tidak cocok dengan hasil baca: ${rinci}. Tidak ada mutasi yang diimpor.`,
      ketidakcocokan,
    );
  }

  return { nomorRekening, periode, saldoAwalSen, rows, footer };
}
