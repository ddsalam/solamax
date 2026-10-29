import { qScoped } from "./db";
import type { PilihanPemilikTitipan } from "./titipan-bright";
import type { ScopedUnitId } from "./scope";

/**
 * U5 (KTD11) — pemilik titipan AKTIF unit ini untuk pilihan formulir Rincian
 * pengawas. Yang nonaktif tak pernah ditawarkan; server action memeriksa ulang
 * (aktif, unit sama, berjenis titipan) sebelum menulis.
 */
export async function getPemilikTitipanAktif(unit: ScopedUnitId): Promise<PilihanPemilikTitipan[]> {
  return qScoped<PilihanPemilikTitipan>(
    unit,
    `SELECT id::text AS id, nama
       FROM app.pihak_lawan
      WHERE unit_id = $1 AND jenis = 'titipan' AND aktif
      ORDER BY nama`,
    [unit],
  );
}
