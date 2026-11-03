"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { bukuBesarAktif, type MasukanCekBukuBesar, type TemuanHargaBeli } from "./buku-besar-cek";
import { bentukUlangHari } from "./buku-besar-tulis";
import { pool } from "./db";
import { canTutupBulan } from "./keuangan-wewenang";
import { getDataScope } from "./scope";
import {
  bacaBahanBukuBesar,
  bacaBahanTutupBulan,
  getBahanTutupBulan,
  getKasKandidatPenjelasan,
  kunciBulanEksklusif,
} from "./tutup-bulan-queries";
import { bulanTutupSah, hariDalamBulan, periksaTutupBulan, syaratK5Lolos, type MasukanTutupBulan } from "./tutup-bulan-model";
import { auditKeuangan, batal, type Aktor } from "./keuangan-tx";
import { buatKlien } from "./rekening-koran-ai";
import {
  BATAS_BUTIR,
  bolehMintaPenjelasan,
  butirTerbuka,
  hashButir,
  jelaskanButir,
  judulButir,
  type PenjelasanButir,
} from "./tutup-bulan-penjelasan";

/**
 * Server action TUTUP BULAN (rencana 2026-10-29 U12; R25; KTD14) + penjelasan
 * AI butir terbuka (rencana 2026-11-02 K6 U11; R32).
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **Syarat dibaca ULANG di server, di bawah kunci.** Yang datang dari client
 *    hanya unit & bulan. Urutannya: kunci advisory EKSKLUSIF (unit, bulan) →
 *    kunci baris `tutup_bulan` → baca semua masukan → vonis → tulis. Membaca
 *    sebelum kunci = jendela tempat tarik rekening koran / batal cocok menyelip
 *    (keduanya memegang kunci BERSAMA yang sama, `bulanTertutupTerkunci`).
 * 2. **Aturan diputuskan SATU tempat**: `periksaTutupBulan`. Berkas ini tidak
 *    menyalin satu pun syarat R25.
 * 3. **Idempoten.** Bulan yang sudah ditutup dijawab "sudah ditutup" tanpa
 *    menulis apa pun; PRIMARY KEY (unit, bulan) menolak tulisan kedua.
 *
 * K6 U11 (R33, KTD3 pemicu 3): bila pemeriksaan buku besar aktif untuk bulan
 * itu, jurnal SETIAP hari bulan itu dibentuk ulang (urut maju) di dalam
 * transaksi yang sama, sesudah keempat syarat K5 lolos, lalu bahan buku besar
 * dibaca ULANG dan ikut vonis. Lolos ⇒ `tutup_bulan.buku_besar = true` (garis
 * beku 0058). Lihat {@link bukuBesarTerkini} untuk kunci yang diambil.
 */

export type TutupBulanResult =
  | { ok: true; sudahDitutup: boolean; pesan: string }
  | { ok: false; error: string; alasan?: readonly string[] };

export interface TutupBulanInput {
  code: string;
  /** `YYYY-MM`. */
  bulan: string;
}

export interface ButirDijelaskan {
  id: string;
  judul: string;
  penjelasan: PenjelasanButir | null;
}

export type JelaskanButirResult =
  | { ok: true; hash: string; dibuatAt: string; butir: ButirDijelaskan[]; tidakDijelaskan: number }
  | { ok: false; error: string };

/**
 * K6 U11, R32 — penjelasan AI untuk butir terbuka bulan ini. Staf Keuangan &
 * HoF (`bolehMintaPenjelasan`). SARAN SAJA: membaca vonis dari
 * `periksaTutupBulan` yang sama dengan halaman, tidak menulis apa pun, tidak
 * menyimpan penjelasan, tidak mengembalikan vonis. `hash` = sidik butir yang
 * dijelaskan — layar menandai USANG bila vonisnya kini bersidik lain.
 */
export async function jelaskanButirTerbuka(input: TutupBulanInput): Promise<JelaskanButirResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!bolehMintaPenjelasan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya staf Keuangan dan Head of Finance yang bisa meminta penjelasan." };
  }
  if (!bulanTutupSah(input.bulan)) return { ok: false, error: "Bulan tak valid." };

  const [bahan, kas] = await Promise.all([getBahanTutupBulan(unit.unit_id, input.bulan), getKasKandidatPenjelasan(unit.unit_id, input.bulan)]);
  const vonis = periksaTutupBulan(bahan);
  const semua = butirTerbuka(vonis, kas);
  const hash = hashButir(semua);
  const dikirim = semua.slice(0, BATAS_BUTIR);
  const h = await jelaskanButir(buatKlien(), { bulan: input.bulan, butir: dikirim });
  if (!h.ok) return { ok: false, error: h.pesan };
  const per = new Map(h.penjelasan.map((p) => [p.id, p]));
  return {
    ok: true,
    hash,
    dibuatAt: new Date().toISOString(),
    butir: dikirim.map((b) => ({ id: b.id, judul: judulButir(b), penjelasan: per.get(b.id) ?? null })),
    tidakDijelaskan: semua.length - dikirim.length,
  };
}

export async function tutupBulan(input: TutupBulanInput): Promise<TutupBulanResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()
  if (!canTutupBulan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh menutup bulan." };
  }
  if (!bulanTutupSah(input.bulan)) return { ok: false, error: "Bulan tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    await kunciBulanEksklusif(client, unit.unit_id, input.bulan);

    const sudah = await client.query<{ ada: number }>(
      `SELECT 1 AS ada FROM app.tutup_bulan
        WHERE unit_id = $1 AND bulan = $2::date
        FOR UPDATE`,
      [unit.unit_id, `${input.bulan}-01`],
    );
    if (sudah.rows.length > 0) {
      await batal(client);
      return { ok: true, sudahDitutup: true, pesan: `Bulan ${input.bulan} sudah ditutup sebelumnya.` };
    }

    // Masukan dari DATA TERKINI, di klien yang memegang kunci (butir 1).
    const bahan = await bacaBahanTutupBulan(client, unit.unit_id, input.bulan);
    const bukuBesar = await bukuBesarTerkini(client, unit.unit_id, input.bulan, bahan, scope);
    const vonis = periksaTutupBulan({ ...bahan, bukuBesar });
    if (!vonis.boleh) {
      await batal(client);
      return { ok: false, error: `Bulan belum bisa ditutup: ${vonis.alasan.join(" ")}`, alasan: vonis.alasan };
    }

    // Memorial yang masih menunggu persetujuan akan terkunci selamanya begitu
    // bulannya beku (setujui/tolak menolak bulan beku) — selesaikan dulu.
    if (vonis.bukuBesar) {
      const menunggu = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.jurnal
          WHERE unit_id = $1 AND status = 'menunggu'
            AND tanggal_efektif >= $2::date AND tanggal_efektif < ($2::date + interval '1 month')`,
        [unit.unit_id, `${input.bulan}-01`],
      );
      const n = menunggu.rows[0]?.n ?? 0;
      if (n > 0) {
        const alasan = [`Ada ${n} jurnal memorial bulan ini yang masih menunggu persetujuan — setujui atau batalkan dulu.`];
        await batal(client);
        return { ok: false, error: `Bulan belum bisa ditutup: ${alasan.join(" ")}`, alasan };
      }
    }

    const ins = await client.query(
      `INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id, buku_besar)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (unit_id, bulan) DO NOTHING`,
      [unit.unit_id, `${input.bulan}-01`, scope.userId, vonis.bukuBesar],
    );
    if (ins.rowCount !== 1) {
      await batal(client);
      return { ok: true, sudahDitutup: true, pesan: `Bulan ${input.bulan} sudah ditutup sebelumnya.` };
    }
    await auditKeuangan(client, scope, "tutup_bulan.tutup", `${unit.code}/${input.bulan}`, {
      bulan: input.bulan,
      hari: bahan.hariTertutup.length,
      rekening: vonis.syarat.rekeningKoran.wajib.map((r) => r.id),
      bukuBesar: vonis.bukuBesar,
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/tutup-bulan/${input.bulan}`);
    return {
      ok: true,
      sudahDitutup: false,
      pesan: vonis.bukuBesar ? `Bulan ${input.bulan} ditutup dengan buku besar — jurnalnya kini beku.` : `Bulan ${input.bulan} ditutup.`,
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menutup bulan." };
  } finally {
    client.release();
  }
}

/**
 * R33 / KTD3 pemicu 3 — bahan buku besar TERKINI untuk vonis. Pemeriksaan tak
 * aktif, atau syarat K5 belum lolos ⇒ bahan tersimpan apa adanya (tanpa
 * pembentukan ulang; vonis toh menolak atau tak memeriksa buku besar).
 * Selain itu: `bentukUlangHari` setiap hari bulan itu, urut maju (P23 membaca
 * saldo persediaan hari sebelumnya), lalu baca ulang dengan temuan
 * "harga beli belum diisi" dari pembentukan itu (U8 tidak menyimpan temuan).
 *
 * ⛔ KUNCI. Pemanggil memegang kunci EKSKLUSIF bulan; `bentukUlangHari`
 * mengambil kunci hari EKSKLUSIF lalu kunci bulan BERSAMA. Kunci bersama di
 * sesi yang sama langsung didapat (Postgres tak pernah membuat sesi menunggu
 * kuncinya sendiri). Kunci hari: karena keempat syarat K5 sudah lolos, semua
 * hari bulan ini tertutup — jalur tulis (`hariBukuTerkunci`) tak lagi
 * memegangnya lama atau menunggu kunci bulan ini sesudahnya; `tutupHari` atas
 * hari yang sudah tertutup berhenti sebelum meminta kunci bulan. Sisa risiko
 * yang diketahui: backfill (`bentukUlangRentang`) atas hari bulan ini yang
 * berjalan BERSAMAAN (hari eksklusif → bulan bersama, urutan terbalik) —
 * Postgres mendeteksi deadlock dan membatalkan salah satunya; tak ada yang
 * menggantung.
 */
async function bukuBesarTerkini(
  client: PoolClient,
  unit: Parameters<typeof bacaBahanBukuBesar>[1],
  bulan: string,
  bahan: MasukanTutupBulan & { bukuBesar: MasukanCekBukuBesar },
  aktor: Aktor,
): Promise<MasukanCekBukuBesar> {
  if (!bukuBesarAktif(bahan.bukuBesar) || !syaratK5Lolos(periksaTutupBulan(bahan))) return bahan.bukuBesar;
  const temuan: TemuanHargaBeli[] = [];
  for (const d of hariDalamBulan(bulan)) {
    const h = await bentukUlangHari(client, unit, d, { aktor });
    for (const t of h.temuan) {
      if (t.kode === "harga_beli_kosong") temuan.push({ tanggal: d, produk: t.produk ?? null, pesan: t.pesan });
    }
  }
  return bacaBahanBukuBesar(client, unit, bulan, temuan);
}
