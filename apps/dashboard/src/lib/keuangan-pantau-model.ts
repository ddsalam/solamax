import type { BarisHargaBeli } from "./keuangan-harga-model";
import type {
  AkunPantau,
  AktivitasPantau,
  BahanPantau,
  JenisKejadian,
  KejadianPantau,
} from "./keuangan-pantau-queries";

/**
 * Model Layar "Pemantauan pemakaian keuangan" — MURNI (tanpa I/O).
 *
 * ⛔ **SATU PEMBUAT VONIS.** Setiap merah/kuning/hijau di layar ini lahir di
 * berkas ini, dengan ambang yang tertulis sebagai konstanta bernama. Halaman
 * hanya merender; kueri hanya menarik fakta.
 *
 * Tiga pertanyaan, dan urutannya disengaja:
 *   1. **Kesiapan** — apakah unit ini SUDAH BISA dibukukan? (akun kas, saldo
 *      pembuka, harga beli). Selama belum, pertanyaan berikutnya tak berarti.
 *   2. **Kedisiplinan** — apakah pekerjaan hariannya DIKERJAKAN? (buku kas
 *      terisi, setoran disetujui, hari ditutup).
 *   3. **Tanda kesalahan** — di mana pekerjaan yang dikerjakan MENYIMPANG?
 *      (pembatalan, pencatatan terlambat, harga di atas jual, selisih).
 *
 * ⚠️ **Tanda kesalahan adalah PETUNJUK, bukan vonis.** Satu pembatalan bisa
 * justru tanda orang yang teliti membetulkan salah ketiknya. Yang berarti
 * adalah POLA — banyak pembatalan oleh satu orang, pencatatan yang selalu
 * terlambat — dan itu yang diringkas `ringkasPelaku`.
 */

export type Nada = "merah" | "kuning" | "hijau";

export type Kelompok = "kesiapan" | "kedisiplinan";

export interface Temuan {
  kelompok: Kelompok;
  /** Kunci stabil — dipakai tes dan CSV, bukan kalimat yang bisa berubah. */
  kode: string;
  nada: Nada;
  judul: string;
  /** Kalimat yang menyebut APA yang kurang dan DI MANA memperbaikinya. */
  rinci: string;
}

/** Ambang — ditulis sebagai nama, bukan angka lepas di tengah logika. */
export const AMBANG = {
  /** Setoran yang belum disetujui lebih tua dari ini ⇒ merah. */
  setoranHariMerah: 2,
  /** Porsi hari penjualan yang bukunya terisi, di bawah ini ⇒ kuning. */
  porsiBukuKuning: 0.8,
  /** Porsi pembatalan terhadap tulisan seseorang, di atas ini ⇒ perlu dilihat. */
  porsiBatalPerhatian: 0.2,
  /** Jumlah tulisan minimum sebelum porsi pembatalan boleh dinilai. */
  minTulisanUntukPorsi: 10,
} as const;

/** Selisih hari antara dua tanggal ISO (`b − a`). */
export function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const rp = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// 1 · Kesiapan
// ---------------------------------------------------------------------------

export function temuanKesiapan(
  akun: readonly AkunPantau[],
  tanpaHarga: readonly { nama: string; hari: number }[],
  harga: readonly BarisHargaBeli[],
): Temuan[] {
  const out: Temuan[] = [];
  const aktif = akun.filter((a) => a.active);

  const punya = (k: AkunPantau["kind"]) => aktif.some((a) => a.kind === k);
  const kurang = [
    !punya("kas") && "Kas Besar",
    !punya("edc_penampungan") && "EDC Penampungan",
    !punya("bank") && "rekening bank",
  ].filter(Boolean) as string[];
  out.push(
    kurang.length
      ? {
          kelompok: "kesiapan",
          kode: "akun",
          nada: "merah",
          judul: "Daftar akun belum lengkap",
          rinci:
            `Belum ada ${kurang.join(" & ")}. Tanpa akun itu, arus kas tunai/EDC tak bisa ` +
            "dicatat sama sekali — daftarkan di Input keuangan › Kelola akun kas.",
        }
      : { kelompok: "kesiapan", kode: "akun", nada: "hijau", judul: "Akun lengkap", rinci: `${aktif.length} akun aktif.` },
  );

  const tanpaSaldo = aktif.filter((a) => !a.adaSaldoAwal);
  out.push(
    aktif.length === 0
      ? {
          kelompok: "kesiapan",
          kode: "saldo_awal",
          nada: "merah",
          judul: "Saldo pembuka belum bisa diisi",
          rinci: "Belum ada akun kas/bank terdaftar.",
        }
      : tanpaSaldo.length
        ? {
            kelompok: "kesiapan",
            kode: "saldo_awal",
            nada: "merah",
            judul: `${tanpaSaldo.length} dari ${aktif.length} akun tanpa saldo pembuka`,
            rinci:
              `${tanpaSaldo.map((a) => a.nama).join(", ")}. Isi saldo pembuka (Head of Finance) ` +
              "SEBELUM mutasi pertama diketik — kas akhir tak bisa dihitung tanpanya.",
          }
        : {
            kelompok: "kesiapan",
            kode: "saldo_awal",
            nada: "hijau",
            judul: "Saldo pembuka lengkap",
            rinci: `Semua ${aktif.length} akun punya saldo pembuka.`,
          },
  );

  if (tanpaHarga.length) {
    out.push({
      kelompok: "kesiapan",
      kode: "harga_kosong",
      nada: "merah",
      judul: "Produk terjual tanpa harga beli",
      rinci:
        tanpaHarga.map((t) => `${t.nama} (${t.hari} hari)`).join(", ") +
        " — laba kotor hari itu tak bisa dihitung. Isi di Input keuangan › blok 1.",
    });
  }
  // P2 dibaca dari fungsi Layar 3 (`barisHargaBeli`) — bukan aturan kedua.
  const p2 = harga.filter((h) => h.p2Due);
  if (p2.length) {
    out.push({
      kelompok: "kesiapan",
      kode: "harga_basi",
      nada: "kuning",
      judul: `Harga beli ${p2.length} produk belum menyusul harga jual`,
      rinci:
        p2.map((h) => `${h.nama} (harga jual berubah ${h.p2StaleDays} hari lalu)`).join(", ") +
        " — laba memakai harga beli lama. Perbarui dari faktur Pertamina terbaru.",
    });
  } else if (!tanpaHarga.length) {
    out.push({
      kelompok: "kesiapan",
      kode: "harga_basi",
      nada: "hijau",
      judul: "Harga beli terkini",
      rinci: "Tak ada produk yang tertinggal.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2 · Kedisiplinan (dalam jendela)
// ---------------------------------------------------------------------------

export interface FaktaKedisiplinan {
  /** Hari dalam jendela yang PUNYA penjualan — penyebut buku kas & tutup hari. */
  hariPenjualan: number;
  hariBermutasi: number;
  mutasiTerakhir: string | null;
  setoranN: number;
  setoranRp: number;
  setoranTertua: string | null;
  ditutup: number;
  dibukaBelumDitutup: number;
  diLuarToleransi: number;
  /** §10.25 — hari berpenjualan EDC & hari yang EDC-nya sudah dibukukan. */
  hariEdc?: number;
  hariEdcDibukukan?: number;
}

export function temuanKedisiplinan(f: FaktaKedisiplinan, sampai: string): Temuan[] {
  const out: Temuan[] = [];
  const penyebut = Math.max(f.hariPenjualan, 1);

  // Tanpa satu hari penjualan pun, "belum dibukukan / belum ditutup" tak
  // bermakna — dulu layar berbunyi "Belum ada hari yang ditutup — 0 hari belum
  // ditutup", kalimat yang membantah dirinya sendiri (terlihat di tier testing).
  if (f.hariPenjualan === 0) {
    return [
      {
        kelompok: "kedisiplinan",
        kode: "tanpa_penjualan",
        nada: "hijau",
        judul: "Tidak ada penjualan dalam jendela ini",
        rinci: "Tak ada yang perlu dibukukan atau ditutup.",
      },
    ];
  }

  // Buku kas
  if (f.hariBermutasi === 0) {
    out.push({
      kelompok: "kedisiplinan",
      kode: "buku_kas",
      nada: "merah",
      judul: "Buku kas tidak diisi",
      rinci:
        (f.mutasiTerakhir
          ? `Mutasi terakhir ${f.mutasiTerakhir} — tidak ada satu pun dalam jendela ini.`
          : "Belum pernah ada satu mutasi kas pun di unit ini.") +
        " Kas akhir & Cash Flow tak bisa dihitung.",
    });
  } else {
    const porsi = f.hariBermutasi / penyebut;
    out.push({
      kelompok: "kedisiplinan",
      kode: "buku_kas",
      nada: porsi < AMBANG.porsiBukuKuning ? "kuning" : "hijau",
      judul: `Buku kas terisi ${f.hariBermutasi} dari ${f.hariPenjualan} hari`,
      rinci: `Mutasi terakhir ${f.mutasiTerakhir ?? "—"}.`,
    });
  }

  // Setoran pengawas yang belum disetujui
  if (f.setoranN > 0) {
    const umur = f.setoranTertua ? selisihHari(f.setoranTertua, sampai) : 0;
    out.push({
      kelompok: "kedisiplinan",
      kode: "setoran",
      nada: umur > AMBANG.setoranHariMerah ? "merah" : "kuning",
      judul: `${f.setoranN} setoran belum disetujui (Rp ${rp(f.setoranRp)})`,
      rinci:
        `Tertua ${f.setoranTertua} (${umur} hari). Setoran yang tak disetujui tidak masuk buku bank — ` +
        "setujui di Input keuangan › blok 2.",
    });
  } else {
    out.push({ kelompok: "kedisiplinan", kode: "setoran", nada: "hijau", judul: "Setoran tertangani", rinci: "Tak ada setoran tertunda." });
  }

  // ⛔ "Biaya menunggu tinjauan" SENGAJA tidak dinilai. Tindakan Tinjau /
  // Kembalikan / Reklasifikasi belum punya tombol (BiayaPanel menampilkannya
  // sebagai teks), jadi setiap baris pengawas selamanya `submitted`. Menagih
  // tim keuangan atas tombol yang belum ada adalah alarm palsu — dan alarm palsu
  // mengajari orang mengabaikan layar ini. Nyalakan kembali begitu tombolnya ada.

  // EDC per shift → EDC Penampungan (§10.25).
  const hariEdc = f.hariEdc ?? 0;
  if (hariEdc > 0) {
    const dib = f.hariEdcDibukukan ?? 0;
    out.push({
      kelompok: "kedisiplinan",
      kode: "edc_penampungan",
      nada: dib === 0 ? "merah" : dib < hariEdc ? "kuning" : "hijau",
      judul:
        dib === 0
          ? "Belum ada hari yang penjualan EDC-nya dibukukan penuh"
          : `Penjualan EDC dibukukan penuh ${dib} dari ${hariEdc} hari`,
      rinci:
        "Pengawas mencocokkan slip per shift di Rincian Penjualan; Keuangan menyetujuinya di Input keuangan › blok 3.",
    });
  }

  // Tutup hari — yang tak pernah dibuka TIDAK punya baris (§10.15), jadi
  // penyebutnya hari penjualan, bukan jumlah baris day_close.
  const belum = Math.max(f.hariPenjualan - f.ditutup, 0);
  out.push({
    kelompok: "kedisiplinan",
    kode: "tutup_hari",
    nada: f.ditutup === 0 ? "merah" : belum > 0 ? "kuning" : "hijau",
    judul:
      f.ditutup === 0 ? "Belum ada hari yang ditutup" : `${f.ditutup} dari ${f.hariPenjualan} hari ditutup`,
    rinci:
      `${belum} hari belum ditutup` +
      (f.dibukaBelumDitutup ? ` (${f.dibukaBelumDitutup} sudah dibuka tapi ditinggalkan)` : "") +
      (f.diLuarToleransi ? ` · ${f.diLuarToleransi} ditutup di luar toleransi` : "") +
      ".",
  });

  return out;
}

// ---------------------------------------------------------------------------
// 3 · Tanda kesalahan
// ---------------------------------------------------------------------------

export const LABEL_KEJADIAN: Record<JenisKejadian, string> = {
  batal_mutasi_kas: "Mutasi kas dibatalkan",
  batal_kaki_edc: "Satu kaki pencairan EDC dibatalkan",
  nominal_besar: "Nominal ketikan sangat besar",
  batal_saldo_awal: "Saldo pembuka dibatalkan",
  batal_harga_beli: "Harga beli dibatalkan",
  batal_settlement: "Settlement EDC dibatalkan",
  batal_beban_nonkas: "Beban non-kas dibatalkan",
  mutasi_terlambat: "Mutasi dicatat terlambat",
  selisih_slip_edc: "Slip EDC berselisih dengan EasyMax",
  harga_beli_di_atas_jual: "Harga beli di atas harga jual",
  selisih_settlement: "Settlement EDC berselisih",
  tutup_di_luar_toleransi: "Hari ditutup di luar toleransi",
  tutup_dengan_selisih: "Hari ditutup dengan selisih kecil",
  keterangan_janggal: "Pos biaya/pendapatan perlu dicek",
};

export const NADA_KEJADIAN: Record<JenisKejadian, Nada> = {
  // Membatalkan saldo pembuka mengubah seluruh saldo sesudahnya — merah.
  batal_saldo_awal: "merah",
  // Pencairan EDC menulis tiga kaki sekaligus; membatalkan satu meninggalkan
  // dua lainnya dan buku tak lagi seimbang — dan batch-nya tak bisa disetujui ulang.
  batal_kaki_edc: "merah",
  nominal_besar: "kuning",
  tutup_di_luar_toleransi: "merah",
  harga_beli_di_atas_jual: "kuning",
  selisih_settlement: "kuning",
  mutasi_terlambat: "kuning",
  selisih_slip_edc: "kuning",
  keterangan_janggal: "kuning",
  batal_mutasi_kas: "kuning",
  batal_harga_beli: "kuning",
  batal_settlement: "kuning",
  batal_beban_nonkas: "kuning",
  tutup_dengan_selisih: "hijau",
};

const URUT_NADA: Record<Nada, number> = { merah: 0, kuning: 1, hijau: 2 };

/** Kejadian diurut: merah dulu, lalu yang terbaru. */
export function urutkanKejadian(k: readonly KejadianPantau[]): KejadianPantau[] {
  return [...k].sort(
    (a, b) =>
      URUT_NADA[NADA_KEJADIAN[a.jenis]] - URUT_NADA[NADA_KEJADIAN[b.jenis]] ||
      b.waktu.localeCompare(a.waktu),
  );
}

/**
 * Kejadian yang DIRINGKAS untuk dibaca manusia.
 *
 * Pos "perlu dicek" yang berulang tiap hari (produksi 26-09: 105 baris, hampir
 * semuanya "SETORAN BRIGHT" di ketujuh unit) adalah SATU pola, bukan 105
 * kejadian — daftar panjang menenggelamkan kejadian lain yang hanya muncul
 * sekali. Karena itu `keterangan_janggal` digabung per unit: jumlah baris,
 * total nominal, dan tiga contoh keterangan. Jenis lain tetap satu per baris.
 */
export interface KejadianRingkas extends KejadianPantau {
  /** Jumlah baris yang digabung (1 untuk kejadian tunggal). */
  jumlah: number;
}

export function ringkasKejadian(k: readonly KejadianPantau[]): KejadianRingkas[] {
  const tunggal: KejadianRingkas[] = [];
  const grup = new Map<number, { baris: KejadianPantau[] }>();
  for (const x of k) {
    if (x.jenis !== "keterangan_janggal") {
      tunggal.push({ ...x, jumlah: 1 });
      continue;
    }
    const g = grup.get(x.unitId) ?? { baris: [] };
    g.baris.push(x);
    grup.set(x.unitId, g);
  }
  const digabung: KejadianRingkas[] = [...grup.entries()].map(([unitId, g]) => {
    const terbaru = [...g.baris].sort((a, b) => b.waktu.localeCompare(a.waktu));
    const contoh = [...new Set(terbaru.map((b) => b.keterangan.replace(/^\w+ — /, "")))].slice(0, 3);
    return {
      unitId,
      jenis: "keterangan_janggal",
      waktu: terbaru[0]!.waktu,
      tanggalBisnis: null,
      pelaku: null,
      keterangan:
        g.baris.length === 1
          ? terbaru[0]!.keterangan
          : `${g.baris.length} baris · contoh: ${contoh.join(" · ")}`,
      nominal: g.baris.reduce((s, b) => s + (b.nominal ?? 0), 0),
      hariTerlambat: null,
      jumlah: g.baris.length,
    };
  });
  return urutkanKejadian([...tunggal, ...digabung]) as KejadianRingkas[];
}

// ---------------------------------------------------------------------------
// 4 · Pelaku
// ---------------------------------------------------------------------------

export interface RingkasPelaku {
  userId: number;
  label: string;
  total: number;
  pembatalan: number;
  perJenis: Record<string, number>;
  terakhir: string;
  /** Porsi pembatalan terhadap tulisan — `null` bila tulisannya terlalu sedikit untuk dinilai. */
  porsiBatal: number | null;
  perhatian: boolean;
}

export function ringkasPelaku(a: readonly AktivitasPantau[]): RingkasPelaku[] {
  const per = new Map<number, RingkasPelaku>();
  for (const r of a) {
    const p =
      per.get(r.userId) ??
      ({
        userId: r.userId,
        label: r.nama ? `${r.nama} (${r.email ?? "?"})` : (r.email ?? `pengguna #${r.userId}`),
        total: 0,
        pembatalan: 0,
        perJenis: {},
        terakhir: r.terakhir,
        porsiBatal: null,
        perhatian: false,
      } satisfies RingkasPelaku);
    p.total += r.n;
    if (r.jenis === "pembatalan") p.pembatalan += r.n;
    p.perJenis[r.jenis] = (p.perJenis[r.jenis] ?? 0) + r.n;
    if (r.terakhir > p.terakhir) p.terakhir = r.terakhir;
    per.set(r.userId, p);
  }
  for (const p of per.values()) {
    const tulisan = p.total - p.pembatalan;
    p.porsiBatal = tulisan >= AMBANG.minTulisanUntukPorsi ? p.pembatalan / tulisan : null;
    p.perhatian = p.porsiBatal !== null && p.porsiBatal > AMBANG.porsiBatalPerhatian;
  }
  return [...per.values()].sort((x, y) => y.terakhir.localeCompare(x.terakhir));
}

// ---------------------------------------------------------------------------
// Rakitan per unit
// ---------------------------------------------------------------------------

export interface BarisPantauUnit {
  unitId: number;
  temuan: Temuan[];
  merah: number;
  kuning: number;
  kejadian: KejadianPantau[];
}

export function nadaTerburuk(t: readonly Temuan[]): Nada {
  if (t.some((x) => x.nada === "merah")) return "merah";
  if (t.some((x) => x.nada === "kuning")) return "kuning";
  return "hijau";
}

export function rakitPantau(unitIds: readonly number[], bahan: BahanPantau): BarisPantauUnit[] {
  const satu = <T extends { unitId: number }>(xs: readonly T[], u: number) => xs.find((x) => x.unitId === u);
  return unitIds
    .map((u) => {
      const bk = satu(bahan.bukuKas, u);
      const st = satu(bahan.setoran, u);
      const th = satu(bahan.tutupHari, u);
      const temuan = [
        ...temuanKesiapan(
          bahan.akun.filter((a) => a.unitId === u),
          bahan.tanpaHarga.filter((t) => t.unitId === u),
          bahan.harga.get(u) ?? [],
        ),
        ...temuanKedisiplinan(
          {
            hariPenjualan: bahan.hariPenjualan.get(u) ?? 0,
            hariBermutasi: bk?.hariBermutasi ?? 0,
            mutasiTerakhir: bk?.mutasiTerakhir ?? null,
            setoranN: st?.n ?? 0,
            setoranRp: st?.rp ?? 0,
            setoranTertua: st?.tertua ?? null,
            ditutup: th?.ditutup ?? 0,
            dibukaBelumDitutup: th?.dibukaBelumDitutup ?? 0,
            diLuarToleransi: th?.diLuarToleransi ?? 0,
            hariEdc: bahan.edc.get(u)?.hariEdc ?? 0,
            hariEdcDibukukan: bahan.edc.get(u)?.hariDibukukan ?? 0,
          },
          bahan.sampai,
        ),
      ];
      return {
        unitId: u,
        temuan,
        merah: temuan.filter((t) => t.nada === "merah").length,
        kuning: temuan.filter((t) => t.nada === "kuning").length,
        kejadian: urutkanKejadian(bahan.kejadian.filter((k) => k.unitId === u)),
      };
    })
    .sort((a, b) => b.merah - a.merah || b.kuning - a.kuning || a.unitId - b.unitId);
}
