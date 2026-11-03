import type { PoolClient } from "pg";
import {
  deltaMaju,
  modeBentukUlang,
  MULAI_BUKU_BESAR,
  periksaRentangBackfill,
  rapikan,
  turunkanHari,
  type BarisJurnal,
  type JurnalTurunan,
  type MasukanHari,
  type StatusBulan,
  type Temuan,
} from "./buku-besar-model";
import { bacaEasymaxHari, bacaSumberHari, type OpsiBaca, type PembacaEasymax } from "./buku-besar-sumber";
import { hariBukuTerkunci, kunciHariEksklusif } from "./hari-buku-queries";
import { KODE_MAJU_BUKU_BESAR } from "./keuangan-kode-maju";
import { addDays } from "./periods";
import { auditKeuangan, batal, type Aktor } from "./keuangan-tx";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS buku besar (rencana 2026-11-02 K6 U8; R6, R7, R13; KTD3). Semua
 * fungsi berjalan DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', …, true)`. Tanpa gerbang wewenang — gerbangnya
 * milik server action (`buku-besar-actions.ts`) atau jalur tulis pemanggil.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `klasifikasi-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban.
 *
 * ⛔ TIGA PINTU, TIGA KUNCI:
 *
 * 1. {@link bentukUlangHari} — seluruh unit-hari, di bawah kunci hari
 *    EKSKLUSIF (`kunciHariEksklusif`, kunci yang sama dengan `tutupHari`) dan
 *    kunci bulan BERSAMA (kunci yang sama dengan `tutupBulan`). Dipanggil
 *    `tutupHari` (sesudah baris `day_close` ditulis, supaya P24 membaca
 *    persetujuannya), pemeriksaan tutup bulan (U11), dan backfill.
 *    ⛔ JANGAN dipanggil dari jalur tulis yang sudah memegang kunci hari
 *    BERSAMA lewat `hariBukuTerkunci`: dua penulis yang sama-sama memegang
 *    kunci bersama lalu meminta kunci eksklusif saling menunggu (deadlock).
 * 2. {@link bentukUlangSumber} — hanya jurnal untuk kunci sumber yang disebut,
 *    tanpa EasyMax. Untuk jalur `*-tulis` (KTD3 pemicu 1), di bawah kunci hari
 *    BERSAMA yang sudah dipegang pemanggil. Tidak pernah menghapus jurnal
 *    sumber lain di hari itu — penulis lain mungkin sedang COMMIT.
 * 3. {@link bentukUlangRentang} — backfill sejak 1 Okt 2026: satu transaksi
 *    pendek per hari, idempoten, bisa diulang dari hari yang gagal.
 *
 * Bulan terbuka: jurnal ditulis ulang dengan kunci sumber yang sama. Bulan
 * tertutup: selisih (turunan baru − tersimpan) diposting sebagai SATU jurnal
 * koreksi di hari buka pertama bulan terbuka berikutnya, kode ADJ-FWD-LEDGER.
 * Setiap pembentukan tercatat di `app.audit_log`.
 */

/** Kunci bulan — HARUS sama persis dengan `KUNCI_BULAN_SQL` di tutup-bulan-queries.ts (dijaga uji). */
export const KUNCI_BULAN_BUKU_BESAR_SQL = "hashtextextended('tutup-bulan:' || $1::text || ':' || $2::text, 0)";

const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface OpsiBentukUlang {
  aktor: Aktor;
  /** Jalur backfill (KTD3): boleh menulis langsung ke bulan yang ditutup K5, sekali. */
  backfill?: boolean;
  easymax?: PembacaEasymax;
  /** Pengganti pembaca sumber (uji). Bawaan: {@link bacaSumberHari}. */
  baca?: (c: PoolClient, unit: ScopedUnitId, tanggal: string, opsi: OpsiBaca) => Promise<MasukanHari>;
}

export interface HasilBentukUlang {
  tanggal: string;
  mode: "langsung" | "koreksi_maju";
  backfill: boolean;
  /** Jurnal sumber yang disisipkan atau diubah. */
  ditulis: number;
  dihapus: number;
  /** Jurnal sumber yang sudah sama persis — tidak disentuh. */
  tetap: number;
  /** Jurnal koreksi maju yang diposting (bulan tertutup). */
  koreksi: { tanggalBuku: string; baris: BarisJurnal[] } | null;
  temuan: Temuan[];
}

interface Tersimpan {
  id: string;
  sumberTabel: string;
  sumberId: string;
  aturan: string;
  tanggalBuku: string;
  tanggalEfektif: string;
  keterangan: string;
  backfill: boolean;
  baris: BarisJurnal[];
}

const SQL_PRASYARAT = `SELECT $1::int = ANY (ARRAY(
           SELECT tok::int
             FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
            WHERE tok ~ '^-?[0-9]+$'
         )) AS "diScope",
         current_setting('transaction_isolation') AS isolasi`;

const SQL_TUTUP_BULAN_UNIT = `SELECT to_char(bulan, 'YYYY-MM') AS bulan, buku_besar AS "bukuBesar"
       FROM app.tutup_bulan WHERE unit_id = $1 ORDER BY bulan`;

const KOLOM_TERSIMPAN = `
  SELECT j.id::text AS id, j.sumber_tabel AS "sumberTabel", j.sumber_id AS "sumberId", j.aturan,
         to_char(j.tanggal_buku, 'YYYY-MM-DD') AS "tanggalBuku",
         to_char(j.tanggal_efektif, 'YYYY-MM-DD') AS "tanggalEfektif",
         j.keterangan, j.backfill,
         COALESCE(json_agg(json_build_object('posKode', b.pos_kode, 'debetSen', b.debet_sen, 'kreditSen', b.kredit_sen)
                           ORDER BY b.pos_kode) FILTER (WHERE b.id IS NOT NULL), '[]'::json) AS baris
    FROM app.jurnal j
    LEFT JOIN app.jurnal_baris b ON b.jurnal_id = j.id AND b.unit_id = j.unit_id`;

/** Jurnal sumber satu hari buku. $1 unit, $2 tanggal. */
export const SQL_JURNAL_SUMBER_HARI = `${KOLOM_TERSIMPAN}
   WHERE j.unit_id = $1 AND j.jenis = 'sumber' AND j.tanggal_buku = $2::date
   GROUP BY j.id`;

/** Jurnal sumber untuk kunci `tabel|id` tertentu, tanggal buku mana pun. $1 unit, $2 text[]. */
export const SQL_JURNAL_SUMBER_KUNCI = `${KOLOM_TERSIMPAN}
   WHERE j.unit_id = $1 AND j.jenis = 'sumber' AND (j.sumber_tabel || '|' || j.sumber_id) = ANY($2::text[])
   GROUP BY j.id`;

/** Baris koreksi maju yang sudah diposting untuk hari $2. */
const SQL_KOREKSI_HARI = `
  SELECT b.pos_kode AS "posKode", b.debet_sen AS "debetSen", b.kredit_sen AS "kreditSen"
    FROM app.jurnal_baris b
    JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
   WHERE j.unit_id = $1 AND j.jenis = 'koreksi' AND j.status = 'aktif'
     AND j.sumber_tabel = 'buku_besar_hari' AND j.sumber_id = $2`;

const SQL_UPSERT_SUMBER = `
  INSERT INTO app.jurnal
    (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, backfill, keterangan)
  VALUES ($1, $2::date, $3::date, 'sumber', $4, $5, $6, $7, $8)
  ON CONFLICT (unit_id, sumber_tabel, sumber_id, aturan) WHERE jenis = 'sumber'
  DO UPDATE SET tanggal_buku = EXCLUDED.tanggal_buku, tanggal_efektif = EXCLUDED.tanggal_efektif,
                backfill = EXCLUDED.backfill, keterangan = EXCLUDED.keterangan, updated_at = now()
  RETURNING id::text AS id`;

const SQL_HAPUS_SUMBER = `DELETE FROM app.jurnal WHERE unit_id = $1 AND jenis = 'sumber' AND id = ANY($2::uuid[])`;
const SQL_HAPUS_BARIS = `DELETE FROM app.jurnal_baris WHERE unit_id = $1 AND jurnal_id = $2::uuid`;
const SQL_SISIP_BARIS = `
  INSERT INTO app.jurnal_baris (jurnal_id, unit_id, pos_kode, debet_sen, kredit_sen)
  SELECT $1::uuid, $2, x.pos, x.d, x.k FROM unnest($3::text[], $4::bigint[], $5::bigint[]) AS x(pos, d, k)`;

const SQL_SISIP_KOREKSI = `
  INSERT INTO app.jurnal
    (unit_id, tanggal_buku, tanggal_efektif, jenis, aturan, sumber_tabel, sumber_id, alasan_maju, keterangan, created_by_user_id)
  VALUES ($1, $2::date, $3::date, 'koreksi', 'ADJ-FWD', 'buku_besar_hari', $3, $4, $5, $6)
  RETURNING id::text AS id`;

// ---------------------------------------------------------------------------

async function pastikanScope(c: PoolClient, unit: ScopedUnitId): Promise<void> {
  const r = (await c.query<{ diScope: boolean; isolasi: string }>(SQL_PRASYARAT, [unit])).rows[0];
  // Tanpa unit di app.unit_ids, RLS menyembunyikan jurnal dan tutup_bulan: semua
  // bulan tampak terbuka dan pembentukan ulang menulis ke bulan beku.
  if (!r?.diScope) {
    throw new Error("buku besar: app.unit_ids transaksi ini tidak memuat unit tujuan — panggil sesudah set_config.");
  }
  if (r.isolasi !== "read committed") throw new Error(`buku besar: butuh READ COMMITTED, transaksi ini ${r.isolasi}.`);
}

/** Kunci bulan BERSAMA (unit, bulan) lalu baca status semua bulan unit itu. */
async function statusBulan(c: PoolClient, unit: ScopedUnitId, bulan: string): Promise<{ status: StatusBulan; adaTutupBukuBesar: boolean }> {
  await c.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_BULAN_BUKU_BESAR_SQL})`, [unit, bulan]);
  const rows = (await c.query<{ bulan: string; bukuBesar: boolean }>(SQL_TUTUP_BULAN_UNIT, [unit])).rows;
  const ini = rows.find((r) => r.bulan === bulan);
  return {
    status: ini === undefined ? "terbuka" : ini.bukuBesar ? "tutup_buku_besar" : "tutup_k5",
    adaTutupBukuBesar: rows.some((r) => r.bukuBesar),
  };
}

const kunci = (x: { sumberTabel: string; sumberId: string; aturan: string }) => `${x.sumberTabel}|${x.sumberId}|${x.aturan}`;
const barisSama = (a: readonly BarisJurnal[], b: readonly BarisJurnal[]) =>
  JSON.stringify(rapikan(a)) === JSON.stringify(rapikan(b));

function keTersimpan(r: Omit<Tersimpan, "baris"> & { baris: { posKode: string; debetSen: number | string; kreditSen: number | string }[] }): Tersimpan {
  return { ...r, baris: r.baris.map((b) => ({ posKode: b.posKode, debetSen: Number(b.debetSen), kreditSen: Number(b.kreditSen) })) };
}

async function sisipBaris(c: PoolClient, unit: ScopedUnitId, jurnalId: string, baris: readonly BarisJurnal[]): Promise<void> {
  await c.query(SQL_SISIP_BARIS, [jurnalId, unit, baris.map((b) => b.posKode), baris.map((b) => b.debetSen), baris.map((b) => b.kreditSen)]);
}

/** Tulis ulang jurnal sumber: hapus yang tak diturunkan lagi, sisipkan/ubah yang berbeda, biarkan yang sama. */
async function tulisLangsung(
  c: PoolClient,
  unit: ScopedUnitId,
  tanggalBuku: string,
  turunan: readonly JurnalTurunan[],
  tersimpan: readonly Tersimpan[],
  backfill: boolean,
): Promise<{ ditulis: number; dihapus: number; tetap: number }> {
  const lama = new Map(tersimpan.map((t) => [kunci(t), t]));
  const baru = new Set(turunan.map(kunci));
  const hapus = tersimpan.filter((t) => !baru.has(kunci(t))).map((t) => t.id);
  if (hapus.length) await c.query(SQL_HAPUS_SUMBER, [unit, hapus]);

  let ditulis = 0;
  let tetap = 0;
  for (const j of turunan) {
    const t = lama.get(kunci(j));
    if (
      t &&
      t.tanggalBuku === tanggalBuku &&
      t.tanggalEfektif === j.tanggalEfektif &&
      t.keterangan === j.keterangan &&
      t.backfill === backfill &&
      barisSama(t.baris, j.baris)
    ) {
      tetap++;
      continue;
    }
    const id = (
      await c.query<{ id: string }>(SQL_UPSERT_SUMBER, [unit, tanggalBuku, j.tanggalEfektif, j.aturan, j.sumberTabel, j.sumberId, backfill, j.keterangan])
    ).rows[0]!.id;
    if (t) await c.query(SQL_HAPUS_BARIS, [unit, id]);
    await sisipBaris(c, unit, id, j.baris);
    ditulis++;
  }
  return { ditulis, dihapus: hapus.length, tetap };
}

function hariPertamaBulanBerikut(tanggal: string): string {
  const [y, m] = tanggal.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function wajibTanggal(tanggal: string): void {
  if (!TANGGAL_RE.test(tanggal)) throw new Error(`buku besar: tanggal harus YYYY-MM-DD, diterima "${tanggal}".`);
  if (tanggal < MULAI_BUKU_BESAR) throw new Error(`buku besar dimulai ${MULAI_BUKU_BESAR} — ${tanggal} tidak dibentuk.`);
}

/**
 * Bentuk ulang SELURUH jurnal sumber satu unit-hari (KTD3 pemicu 2 dan 3, dan
 * backfill). Lihat kepala berkas untuk kunci yang diambil.
 */
export async function bentukUlangHari(
  c: PoolClient,
  unit: ScopedUnitId,
  tanggal: string,
  opsi: OpsiBentukUlang,
): Promise<HasilBentukUlang> {
  wajibTanggal(tanggal);
  await pastikanScope(c, unit);
  await kunciHariEksklusif(c, unit, tanggal);
  const bulan = tanggal.slice(0, 7);
  const st = await statusBulan(c, unit, bulan);
  const mode = modeBentukUlang(st.status, { backfill: opsi.backfill === true, adaTutupBukuBesar: st.adaTutupBukuBesar });
  if ("tolak" in mode) throw new Error(`Bentuk ulang ${tanggal} ditolak: ${mode.tolak}`);

  const baca = opsi.baca ?? bacaSumberHari;
  const masukan = await baca(c, unit, tanggal, { easymax: opsi.easymax ?? bacaEasymaxHari });
  const { jurnal, temuan } = turunkanHari(masukan);
  const tersimpan = (await c.query<Parameters<typeof keTersimpan>[0]>(SQL_JURNAL_SUMBER_HARI, [unit, tanggal])).rows.map(keTersimpan);

  let hasil: HasilBentukUlang;
  if (mode.mode === "langsung") {
    const n = await tulisLangsung(c, unit, tanggal, jurnal, tersimpan, mode.backfill);
    hasil = { tanggal, mode: "langsung", backfill: mode.backfill, ...n, koreksi: null, temuan };
  } else {
    const koreksiLama = (await c.query<{ posKode: string; debetSen: number | string; kreditSen: number | string }>(SQL_KOREKSI_HARI, [unit, tanggal])).rows.map(
      (b) => ({ posKode: b.posKode, debetSen: Number(b.debetSen), kreditSen: Number(b.kreditSen) }),
    );
    const delta = deltaMaju([...tersimpan.flatMap((t) => t.baris), ...koreksiLama], jurnal.flatMap((j) => j.baris));
    let koreksi: HasilBentukUlang["koreksi"] = null;
    if (delta.length > 0) {
      const hb = await hariBukuTerkunci(c, unit, hariPertamaBulanBerikut(tanggal));
      if (hb.status !== "dibukukan") throw new Error(`buku besar: tak ada hari buku untuk koreksi ${tanggal}.`);
      const bulanBuku = hb.hariBuku.slice(0, 7);
      if ((await statusBulan(c, unit, bulanBuku)).status !== "terbuka") {
        throw new Error(`buku besar: hari buku koreksi ${hb.hariBuku} jatuh di bulan tertutup.`);
      }
      const id = (
        await c.query<{ id: string }>(SQL_SISIP_KOREKSI, [
          unit,
          hb.hariBuku,
          tanggal,
          KODE_MAJU_BUKU_BESAR,
          `Koreksi buku besar ${tanggal} (bulan ${bulan} tertutup)`,
          opsi.aktor.userId,
        ])
      ).rows[0]!.id;
      await sisipBaris(c, unit, id, delta);
      koreksi = { tanggalBuku: hb.hariBuku, baris: delta };
    }
    hasil = { tanggal, mode: "koreksi_maju", backfill: false, ditulis: 0, dihapus: 0, tetap: tersimpan.length, koreksi, temuan };
  }

  await auditKeuangan(c, opsi.aktor, "buku_besar.bentuk_ulang", `${unit}/${tanggal}`, {
    mode: hasil.mode,
    backfill: hasil.backfill,
    ditulis: hasil.ditulis,
    dihapus: hasil.dihapus,
    tetap: hasil.tetap,
    koreksi: hasil.koreksi?.tanggalBuku ?? null,
    temuan: temuan.map((t) => t.kode),
  });
  return hasil;
}

/**
 * Bentuk ulang jurnal untuk kunci sumber tertentu saja (KTD3 pemicu 1) — jalur
 * `*-tulis` memanggilnya sesudah menulis/membatalkan catatannya, di bawah kunci
 * hari BERSAMA yang ia pegang lewat `hariBukuTerkunci`. `tanggal` = hari buku
 * catatan itu. Bulan tertutup ditolak: jalur tulis tidak pernah menulis ke sana.
 */
export async function bentukUlangSumber(
  c: PoolClient,
  unit: ScopedUnitId,
  tanggal: string,
  sumber: readonly { sumberTabel: string; sumberId: string }[],
  opsi: OpsiBentukUlang,
): Promise<HasilBentukUlang> {
  wajibTanggal(tanggal);
  await pastikanScope(c, unit);
  const st = await statusBulan(c, unit, tanggal.slice(0, 7));
  if (st.status !== "terbuka") throw new Error(`buku besar: bulan ${tanggal.slice(0, 7)} tertutup — catatan baru tidak boleh berhari buku di sana.`);

  const baca = opsi.baca ?? bacaSumberHari;
  const { jurnal, temuan } = turunkanHari(await baca(c, unit, tanggal, { easymax: null }));
  const diminta = new Set(sumber.map((s) => `${s.sumberTabel}|${s.sumberId}`));
  const turunan = jurnal.filter((j) => diminta.has(`${j.sumberTabel}|${j.sumberId}`));
  const tersimpan = (await c.query<Parameters<typeof keTersimpan>[0]>(SQL_JURNAL_SUMBER_KUNCI, [unit, [...diminta]])).rows.map(keTersimpan);
  const n = await tulisLangsung(c, unit, tanggal, turunan, tersimpan, false);
  const temuanSumber = temuan.filter((t) => t.sumberId !== undefined && [...diminta].some((k) => k.endsWith(`|${t.sumberId}`)));
  await auditKeuangan(c, opsi.aktor, "buku_besar.bentuk_sumber", `${unit}/${tanggal}`, {
    sumber: [...diminta],
    ...n,
    temuan: temuanSumber.map((t) => t.kode),
  });
  return { tanggal, mode: "langsung", backfill: false, ...n, koreksi: null, temuan: temuanSumber };
}

export type HasilRentang =
  | { ok: true; hari: HasilBentukUlang[] }
  | { ok: false; error: string; hari: HasilBentukUlang[] };

/**
 * Backfill / pemulihan sejak 1 Okt 2026 (R7, KTD3): rentang diperiksa sekali di
 * depan (bulan yang sudah ditutup dengan buku besar ⇒ seluruh rentang ditolak,
 * tanpa satu hari pun ditulis), lalu SATU transaksi pendek per hari, urut maju
 * — P23 hari berikutnya membaca saldo persediaan hari sebelumnya. Gagal di
 * tengah = berhenti; hari yang sudah COMMIT tetap, dan permintaan yang sama
 * bisa diulang karena pembentukan idempoten.
 */
export async function bentukUlangRentang(
  buka: () => Promise<PoolClient>,
  unit: ScopedUnitId,
  dari: string,
  sampai: string,
  opsi: Omit<OpsiBentukUlang, "backfill">,
): Promise<HasilRentang> {
  const awal = await buka();
  let bulanTertutup: { bulan: string; bukuBesar: boolean }[];
  try {
    await awal.query("BEGIN");
    await awal.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit)]);
    bulanTertutup = (await awal.query<{ bulan: string; bukuBesar: boolean }>(SQL_TUTUP_BULAN_UNIT, [unit])).rows;
    await awal.query("ROLLBACK");
  } catch (e) {
    await batal(awal);
    throw e;
  } finally {
    awal.release();
  }
  const salah = periksaRentangBackfill({ dari, sampai, bulanTertutup });
  if (salah !== null) return { ok: false, error: salah, hari: [] };

  const hari: HasilBentukUlang[] = [];
  for (let d = dari; d <= sampai; d = addDays(d, 1)) {
    const c = await buka();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit)]);
      hari.push(await bentukUlangHari(c, unit, d, { ...opsi, backfill: true }));
      await c.query("COMMIT");
    } catch (e) {
      await batal(c);
      return { ok: false, error: `${d}: ${e instanceof Error ? e.message : String(e)}`, hari };
    } finally {
      c.release();
    }
  }
  return { ok: true, hari };
}
