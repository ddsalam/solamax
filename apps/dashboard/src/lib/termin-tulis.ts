import type { PoolClient } from "pg";
import { auditKeuangan, type Aktor } from "./keuangan-tx";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS termin pembayaran (rencana 2026-11-13 U4; R14–R16, KTD6, KTD7) —
 * dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', …, true)`. Tanpa gerbang wewenang: gerbangnya
 * milik server action (`termin-actions.ts`) dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server": setiap fungsi ekspor di berkas seperti
 * itu menjadi endpoint yang bisa dipanggil peramban — termasuk fungsi tanpa
 * gerbang di bawah ini. Dipisah supaya uji DB-live (`termin.integration
 * .test.ts`) menguji SQL yang sama dengan yang dijalankan aksi.
 *
 * Pola `tulisSatuSisi` (`pihak-lawan-tulis.ts`): baris aktif dikunci
 * `FOR UPDATE`, di-VOID, yang baru disisipkan, `audit_log` mencatat nilai lama
 * dan baru. Indeks unik parsial 0064 menjamin satu baris aktif.
 *
 * ⛔ Nilai yang SAMA dengan yang berlaku = TIDAK MENULIS APA PUN — tanpa void,
 * tanpa insert, tanpa audit. Riwayat termin adalah daftar PERUBAHAN; menyimpan
 * ulang angka yang sama akan mengisinya dengan baris yang tak mengubah apa-apa
 * dan mengganti "siapa & kapan" tanpa ada keputusan baru.
 */

/** Batas termin dalam hari (0064: CHECK `BETWEEN 0 AND 365`). Nol sah. */
export const TERMIN_HARI_MIN = 0;
export const TERMIN_HARI_MAKS = 365;

/** Lebar `pelanggan_master.ckdplg` / `termin_pelanggan.kode_pelanggan`. */
export const KODE_PELANGGAN_MAKS = 12;

/** `null` = sah; selain itu pesan untuk pengguna. Murni. */
export function periksaTerminHari(terminHari: unknown): string | null {
  if (typeof terminHari !== "number" || !Number.isInteger(terminHari)) {
    return "Termin harus bilangan bulat dalam hari.";
  }
  if (terminHari < TERMIN_HARI_MIN || terminHari > TERMIN_HARI_MAKS) {
    return `Termin harus ${TERMIN_HARI_MIN} sampai ${TERMIN_HARI_MAKS} hari.`;
  }
  return null;
}

/**
 * Kode pelanggan dalam bentuk KUNCI: terpangkas spasi pinggir, selain itu APA
 * ADANYA — huruf besar/kecil, garis miring (`NOL/02`), dan titik (kode Online)
 * tidak disentuh. Bentuk yang sama dengan `btrim(ckdplg)` di layar Saldo
 * pelanggan dan dengan `customer_code` snapshot (0037). `null` = bukan kode
 * (kosong, bukan teks, atau lebih lebar dari kolom sumbernya). Murni.
 *
 * ⚠️ Hanya SPASI ASCII yang dipangkas — itulah yang dipangkas `btrim()`
 * Postgres. `String.trim()` juga membuang NBSP/BOM, sehingga kode yang
 * "dinormalkan" di sini bisa berbeda dari kunci yang dipakai SQL.
 */
export function normalKodePelanggan(kode: unknown): string | null {
  if (typeof kode !== "string") return null;
  const k = kode.replace(/^ +| +$/g, "");
  if (k === "" || k.length > KODE_PELANGGAN_MAKS) return null;
  return k;
}

export type HasilTulisTermin =
  | {
      ok: true;
      /** `false` = nilai sama dengan yang berlaku; tak ada yang ditulis. */
      berubah: boolean;
      /** Termin yang berlaku SEBELUM panggilan ini; `null` = belum pernah diatur. */
      sebelumnya: number | null;
      /** Termin yang berlaku SESUDAH panggilan ini; `null` = pengecualian dihapus. */
      terminHari: number | null;
    }
  | { ok: false; error: string };

interface UnitTulis {
  unitId: ScopedUnitId;
  code: string;
}

type Tabel = "termin_unit" | "termin_pelanggan";

/** Baris aktif, DIKUNCI sampai transaksi selesai — dua penyimpan bersamaan berurutan. */
async function bacaAktifTerkunci(
  c: PoolClient,
  tabel: Tabel,
  unitId: ScopedUnitId,
  kodePelanggan: string | null,
): Promise<{ id: string; terminHari: number } | null> {
  const r =
    tabel === "termin_unit"
      ? await c.query<{ id: string; terminHari: number }>(
          `SELECT id::text AS id, termin_hari AS "terminHari"
             FROM app.termin_unit
            WHERE unit_id = $1 AND NOT void
            FOR UPDATE`,
          [unitId],
        )
      : await c.query<{ id: string; terminHari: number }>(
          `SELECT id::text AS id, termin_hari AS "terminHari"
             FROM app.termin_pelanggan
            WHERE unit_id = $1 AND kode_pelanggan = $2 AND NOT void
            FOR UPDATE`,
          [unitId, kodePelanggan],
        );
  return r.rows[0] ?? null;
}

/** VOID satu baris aktif. `false` = barisnya sudah bukan baris aktif (berubah bersamaan). */
async function voidBaris(c: PoolClient, tabel: Tabel, unitId: ScopedUnitId, id: string, aktor: Aktor): Promise<boolean> {
  const r =
    tabel === "termin_unit"
      ? await c.query(
          `UPDATE app.termin_unit
              SET void = true, voided_by_user_id = $2, voided_at = now()
            WHERE id = $1::uuid AND unit_id = $3 AND NOT void`,
          [id, aktor.userId, unitId],
        )
      : await c.query(
          `UPDATE app.termin_pelanggan
              SET void = true, voided_by_user_id = $2, voided_at = now()
            WHERE id = $1::uuid AND unit_id = $3 AND NOT void`,
          [id, aktor.userId, unitId],
        );
  return r.rowCount === 1;
}

const PESAN_BERUBAH_BERSAMAAN = "Termin berubah bersamaan — muat ulang halaman.";

/**
 * Tetapkan/ganti termin BAWAAN unit (R14). Berlaku seketika untuk setiap
 * faktur unit ini yang tak punya jatuh tempo EasyMax sah dan tak punya
 * pengecualian pelanggan (KTD7).
 */
export async function tulisTerminUnit(
  c: PoolClient,
  m: { unit: UnitTulis; terminHari: number; aktor: Aktor },
): Promise<HasilTulisTermin> {
  const salah = periksaTerminHari(m.terminHari);
  if (salah !== null) return { ok: false, error: salah };

  const lama = await bacaAktifTerkunci(c, "termin_unit", m.unit.unitId, null);
  if (lama !== null && lama.terminHari === m.terminHari) {
    return { ok: true, berubah: false, sebelumnya: lama.terminHari, terminHari: lama.terminHari };
  }
  if (lama !== null && !(await voidBaris(c, "termin_unit", m.unit.unitId, lama.id, m.aktor))) {
    return { ok: false, error: PESAN_BERUBAH_BERSAMAAN };
  }
  await c.query(
    `INSERT INTO app.termin_unit (unit_id, termin_hari, created_by_user_id)
     VALUES ($1, $2, $3)`,
    [m.unit.unitId, m.terminHari, m.aktor.userId],
  );
  await auditKeuangan(c, m.aktor, lama === null ? "termin.unit.tetapkan" : "termin.unit.ganti", m.unit.code, {
    unit: m.unit.code,
    terminHari: m.terminHari,
    sebelumnya: lama === null ? null : { terminHari: lama.terminHari },
  });
  return { ok: true, berubah: true, sebelumnya: lama?.terminHari ?? null, terminHari: m.terminHari };
}

/**
 * Pelanggan di master cermin unit ini, dalam bentuk kunci. `GROUP BY` karena
 * `ckdplg` CHAR(12) yang berbeda hanya di spasi DEPAN memangkas ke kode yang
 * sama (bentuk yang sama dengan `saldo-snapshot.ts`).
 *
 * ⚠️ Tanpa kunci baris: `pelanggan_master` cermin EasyMax, `dashboard_app`
 * hanya punya SELECT (0013) dan `FOR SHARE` menuntut UPDATE. Pelanggan yang
 * terhapus dari master tepat sesudah pembacaan ini meninggalkan pengecualian
 * yatim — terbaca, tak berbahaya, dan tetap bisa dihapus.
 */
async function bacaPelangganMaster(
  c: PoolClient,
  unitId: ScopedUnitId,
  kode: string,
): Promise<{ kode: string; nama: string | null } | null> {
  const r = await c.query<{ kode: string; nama: string | null }>(
    `SELECT btrim(ckdplg) AS kode, max(vcnmplg) AS nama
       FROM public.pelanggan_master
      WHERE unit_id = $1 AND btrim(ckdplg) = $2
      GROUP BY btrim(ckdplg)`,
    [unitId, kode],
  );
  return r.rows[0] ?? null;
}

/**
 * Tetapkan/ganti PENGECUALIAN termin satu pelanggan (R14). Pelanggan WAJIB ada
 * di master cermin unit ini — kode yang disimpan adalah kode master yang
 * terbaca, bukan ketikan pemanggil.
 */
export async function tulisTerminPelanggan(
  c: PoolClient,
  m: { unit: UnitTulis; kodePelanggan: string; terminHari: number; aktor: Aktor },
): Promise<HasilTulisTermin> {
  const salah = periksaTerminHari(m.terminHari);
  if (salah !== null) return { ok: false, error: salah };
  const kode = normalKodePelanggan(m.kodePelanggan);
  if (kode === null) return { ok: false, error: "Kode pelanggan tak dikenali — muat ulang halaman." };

  const pelanggan = await bacaPelangganMaster(c, m.unit.unitId, kode);
  if (pelanggan === null) {
    return { ok: false, error: `Pelanggan “${kode}” tak ada di master pelanggan unit ini — muat ulang halaman.` };
  }

  const lama = await bacaAktifTerkunci(c, "termin_pelanggan", m.unit.unitId, pelanggan.kode);
  if (lama !== null && lama.terminHari === m.terminHari) {
    return { ok: true, berubah: false, sebelumnya: lama.terminHari, terminHari: lama.terminHari };
  }
  if (lama !== null && !(await voidBaris(c, "termin_pelanggan", m.unit.unitId, lama.id, m.aktor))) {
    return { ok: false, error: PESAN_BERUBAH_BERSAMAAN };
  }
  await c.query(
    `INSERT INTO app.termin_pelanggan (unit_id, kode_pelanggan, termin_hari, created_by_user_id)
     VALUES ($1, $2, $3, $4)`,
    [m.unit.unitId, pelanggan.kode, m.terminHari, m.aktor.userId],
  );
  await auditKeuangan(
    c,
    m.aktor,
    lama === null ? "termin.pelanggan.tetapkan" : "termin.pelanggan.ganti",
    `${m.unit.code}/${pelanggan.kode}`,
    {
      unit: m.unit.code,
      kodePelanggan: pelanggan.kode,
      namaPelanggan: pelanggan.nama,
      terminHari: m.terminHari,
      sebelumnya: lama === null ? null : { terminHari: lama.terminHari },
    },
  );
  return { ok: true, berubah: true, sebelumnya: lama?.terminHari ?? null, terminHari: m.terminHari };
}

/**
 * HAPUS pengecualian satu pelanggan — void TANPA baris pengganti, sehingga
 * pelanggan kembali memakai termin bawaan unit. Master TIDAK diperiksa:
 * pengecualian milik pelanggan yang sudah lenyap dari master harus tetap bisa
 * dibersihkan.
 */
export async function cabutTerminPelanggan(
  c: PoolClient,
  m: { unit: UnitTulis; kodePelanggan: string; aktor: Aktor },
): Promise<HasilTulisTermin> {
  const kode = normalKodePelanggan(m.kodePelanggan);
  if (kode === null) return { ok: false, error: "Kode pelanggan tak dikenali — muat ulang halaman." };

  const lama = await bacaAktifTerkunci(c, "termin_pelanggan", m.unit.unitId, kode);
  if (lama === null) {
    return { ok: false, error: "Pelanggan ini tidak punya pengecualian termin — muat ulang halaman." };
  }
  if (!(await voidBaris(c, "termin_pelanggan", m.unit.unitId, lama.id, m.aktor))) {
    return { ok: false, error: PESAN_BERUBAH_BERSAMAAN };
  }
  await auditKeuangan(c, m.aktor, "termin.pelanggan.hapus", `${m.unit.code}/${kode}`, {
    unit: m.unit.code,
    kodePelanggan: kode,
    terminHari: null,
    sebelumnya: { terminHari: lama.terminHari },
  });
  return { ok: true, berubah: true, sebelumnya: lama.terminHari, terminHari: null };
}
