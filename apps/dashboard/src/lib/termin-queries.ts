import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope";
import type { TagihanTermin } from "./tagihan-model";

/**
 * Kueri baca termin pembayaran (rencana 2026-11-13 U4; R14, R16, KTD6, KTD7).
 * Semuanya lewat `qScoped()` dengan `ScopedUnitId` ber-brand — RLS `unit_scope`
 * 0064 + `unit_id` di WHERE.
 *
 * Hanya baris AKTIF (`NOT void`) yang dibaca: itulah termin yang berlaku
 * sekarang (KTD7 — tak ada tanggal berlaku, tak ada termin per faktur). Baris
 * void adalah riwayat; jejak perubahannya ada di `app.audit_log`
 * (`termin.unit.*`, `termin.pelanggan.*`).
 *
 * Kode pelanggan SELALU dalam bentuk kunci `btrim(ckdplg)` — bentuk yang sama
 * dengan layar Saldo pelanggan — supaya peta termin bisa dicocokkan dengan
 * `btrim(tagihan_header.ckdplg)` tanpa aturan tambahan.
 */

/** Zona tampilan "kapan" — sama dengan `tutup-bulan-queries.ts`. */
const WAKTU = (kolom: string): string => `to_char(${kolom} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')`;

export interface TerminUnitRow {
  terminHari: number;
  /** Email penetap; `null` bila akunnya sudah tak ada. */
  diaturOleh: string | null;
  /** WIB, `YYYY-MM-DD HH:MM`. */
  diaturAt: string;
}

/** Termin BAWAAN unit yang berlaku; `null` = belum pernah diatur. */
export async function getTerminUnit(unit: ScopedUnitId): Promise<TerminUnitRow | null> {
  const r = await qScoped<TerminUnitRow>(
    unit,
    `SELECT t.termin_hari          AS "terminHari",
            u.email                AS "diaturOleh",
            ${WAKTU("t.created_at")} AS "diaturAt"
       FROM app.termin_unit t
       LEFT JOIN app.users u ON u.id = t.created_by_user_id
      WHERE t.unit_id = $1 AND NOT t.void`,
    [unit],
  );
  return r[0] ?? null;
}

export interface TerminPelangganRow {
  kodePelanggan: string;
  /** Nama dari master cermin; `null` bila pelanggannya sudah tak ada di master. */
  namaPelanggan: string | null;
  terminHari: number;
  diaturOleh: string | null;
  diaturAt: string;
}

/**
 * Pengecualian termin yang berlaku di unit ini, urut kode. Pengecualian yang
 * pelanggannya lenyap dari master TETAP tampil (nama `null`) — kalau
 * disembunyikan, ia terus menggeser jatuh tempo tanpa bisa dilihat atau dihapus.
 */
export async function getTerminPelanggan(unit: ScopedUnitId): Promise<TerminPelangganRow[]> {
  return qScoped<TerminPelangganRow>(
    unit,
    `SELECT t.kode_pelanggan       AS "kodePelanggan",
            m.nama                 AS "namaPelanggan",
            t.termin_hari          AS "terminHari",
            u.email                AS "diaturOleh",
            ${WAKTU("t.created_at")} AS "diaturAt"
       FROM app.termin_pelanggan t
       LEFT JOIN (
         SELECT btrim(ckdplg) AS kode, max(vcnmplg) AS nama
           FROM public.pelanggan_master
          WHERE unit_id = $1
          GROUP BY btrim(ckdplg)
       ) m ON m.kode = t.kode_pelanggan
       LEFT JOIN app.users u ON u.id = t.created_by_user_id
      WHERE t.unit_id = $1 AND NOT t.void
      ORDER BY t.kode_pelanggan`,
    [unit],
  );
}

export interface PelangganTerminRow {
  kodePelanggan: string;
  namaPelanggan: string | null;
  /** `false` = pengecualian yatim: pelanggannya tak ada lagi di master. */
  diMaster: boolean;
  /**
   * Kelas pelanggan di master cermin (`sjenis`); `null` = tak ada di master atau
   * kelasnya kosong. Bila satu kode punya lebih dari satu baris master, kelas
   * piutang (1 atau 5) didahulukan — sama dengan `EXISTS` populasi piutang.
   */
  kelas: number | null;
  /** `null` = tanpa pengecualian — "pakai bawaan unit". */
  terminHari: number | null;
  diaturOleh: string | null;
  diaturAt: string | null;
}

/** Kelas master yang berarti pelanggan piutang Lokal — sama dengan populasi "belum ditagihkan". */
const KELAS_PIUTANG: readonly number[] = [1, 5];

/**
 * Pelanggan ini BISA punya piutang — aturan populasi yang sama dengan kueri
 * "belum ditagihkan" (`SQL_POPULASI_PIUTANG` di `tagihan-queries.ts`): kode
 * bertitik (Online, tanpa saringan kelas), atau kode tanpa titik berkelas 1/5.
 * Murni.
 */
export function pelangganBisaPiutang(p: Pick<PelangganTerminRow, "kodePelanggan" | "kelas">): boolean {
  return p.kodePelanggan.includes(".") || (p.kelas !== null && KELAS_PIUTANG.includes(Number(p.kelas)));
}

/**
 * Daftar bawaan layar "Atur termin": pelanggan yang bisa punya piutang, DITAMBAH
 * setiap pelanggan yang sudah punya pengecualian (termasuk yang yatim) —
 * pengecualian tak boleh tersembunyi, berapa pun kelasnya. Murni.
 */
export function pelangganTerminBawaan<T extends Pick<PelangganTerminRow, "kodePelanggan" | "kelas" | "terminHari">>(
  rows: readonly T[],
): T[] {
  return rows.filter((p) => p.terminHari !== null || pelangganBisaPiutang(p));
}

/**
 * SELURUH pelanggan master unit ini beserta pengecualiannya (bila ada) —
 * daftar kerja layar "Atur termin" (S4). `FULL JOIN`: pengecualian yatim ikut
 * tampil, lihat {@link getTerminPelanggan}. Penyempitan ke pelanggan piutang
 * dilakukan pemanggil lewat {@link pelangganTerminBawaan}.
 */
export async function getPelangganUntukTermin(unit: ScopedUnitId): Promise<PelangganTerminRow[]> {
  return qScoped<PelangganTerminRow>(
    unit,
    `SELECT COALESCE(m.kode, t.kode_pelanggan) AS "kodePelanggan",
            m.nama                             AS "namaPelanggan",
            (m.kode IS NOT NULL)               AS "diMaster",
            m.kelas                            AS kelas,
            t.termin_hari                      AS "terminHari",
            u.email                            AS "diaturOleh",
            ${WAKTU("t.created_at")}             AS "diaturAt"
       FROM (
         SELECT btrim(ckdplg) AS kode, max(vcnmplg) AS nama,
                COALESCE(min(sjenis) FILTER (WHERE sjenis IN (1, 5)), max(sjenis))::int AS kelas
           FROM public.pelanggan_master
          WHERE unit_id = $1 AND NULLIF(btrim(ckdplg), '') IS NOT NULL
          GROUP BY btrim(ckdplg)
       ) m
       FULL JOIN (
         SELECT kode_pelanggan, termin_hari, created_by_user_id, created_at
           FROM app.termin_pelanggan
          WHERE unit_id = $1 AND NOT void
       ) t ON t.kode_pelanggan = m.kode
       LEFT JOIN app.users u ON u.id = t.created_by_user_id
      ORDER BY 1`,
    [unit],
  );
}

/**
 * Termin yang berlaku di satu unit dalam bentuk CARI — untuk kueri daftar
 * faktur: satu pembacaan per unit, lalu {@link terminUntuk} per faktur.
 */
export interface PetaTermin {
  /** Termin bawaan unit; `null` = belum diatur. */
  terminUnit: number | null;
  /**
   * {@link kunciTermin} dari `btrim(ckdplg)` → termin pengecualian. Kuncinya
   * TIDAK peka huruf besar/kecil — selalu dibaca lewat {@link terminUntuk}.
   */
  terminPelanggan: ReadonlyMap<string, number>;
}

/**
 * Kunci cari termin satu pelanggan: spasi ASCII pinggir dipangkas, lalu huruf
 * besar. EasyMax membandingkan kode pelanggan tanpa membedakan huruf besar/
 * kecil, jadi pengecualian `abc` berlaku untuk faktur ber-kode `ABC`. Hanya
 * pencarian termin yang begini; join dan pengelompokan lain tetap persis.
 */
export function kunciTermin(kodePelanggan: string): string {
  return kodePelanggan.replace(/^ +| +$/g, "").toUpperCase();
}

export async function getPetaTermin(unit: ScopedUnitId): Promise<PetaTermin> {
  // SATU kueri, bukan dua: bawaan dan pengecualian dibaca dari potret yang sama.
  const rows = await qScoped<{ kodePelanggan: string | null; terminHari: number }>(
    unit,
    `SELECT NULL::text AS "kodePelanggan", termin_hari AS "terminHari"
       FROM app.termin_unit
      WHERE unit_id = $1 AND NOT void
     UNION ALL
     SELECT kode_pelanggan::text, termin_hari
       FROM app.termin_pelanggan
      WHERE unit_id = $1 AND NOT void`,
    [unit],
  );
  let terminUnit: number | null = null;
  const terminPelanggan = new Map<string, number>();
  for (const r of rows) {
    if (r.kodePelanggan === null) terminUnit = r.terminHari;
    else terminPelanggan.set(kunciTermin(r.kodePelanggan), r.terminHari);
  }
  return { terminUnit, terminPelanggan };
}

/**
 * Termin untuk SATU faktur, dalam bentuk yang diminta `resolveJatuhTempo`
 * (`tagihan-model.ts`): pengecualian pelanggan bila ada, dan termin unit.
 * Kode dipangkas spasi ASCII pinggirnya dan dicocokkan TANPA membedakan huruf
 * besar/kecil ({@link kunciTermin}) — pemanggil boleh menyerahkan
 * `tagihan_header.ckdplg` apa adanya. Murni.
 */
export function terminUntuk(peta: PetaTermin, kodePelanggan: string | null | undefined): TagihanTermin {
  const kode = typeof kodePelanggan === "string" ? kunciTermin(kodePelanggan) : "";
  return {
    terminPelanggan: kode === "" ? null : (peta.terminPelanggan.get(kode) ?? null),
    terminUnit: peta.terminUnit,
  };
}
