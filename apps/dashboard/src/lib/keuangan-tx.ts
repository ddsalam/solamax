/**
 * Pembantu transaksi bersama aksi Keuangan — satu salinan untuk pola yang
 * sebelumnya diulang di tiap berkas `*-actions.ts` / `*-tulis.ts`.
 *
 * ⚠️ Modul biasa (BUKAN "use server"): diimpor oleh aksi server dan inti tulis;
 * tak ada fungsi di sini yang boleh terpapar sebagai server action.
 */

/** Siapa yang menulis — cukup id & email untuk jejak `app.audit_log`. */
export interface Aktor {
  userId: number;
  email: string | null;
}

/** ROLLBACK yang menelan galatnya sendiri — galat asal tetap yang dilaporkan. */
export async function batal(client: { query: (s: string) => Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
}

/** Jejak wajib: siapa, aksi apa, atas apa, dengan rincian apa (di transaksi pemanggil). */
export async function auditKeuangan(
  c: { query: (s: string, p: unknown[]) => Promise<unknown> },
  aktor: Aktor,
  action: string,
  target: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await c.query(
    `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [aktor.userId, aktor.email, action, target, JSON.stringify(detail)],
  );
}

/** Pesan bila kode alasan koreksi tak ada di master (atau kode pembukuan maju). */
export const PESAN_KODE_ALASAN_TAK_DIKENAL = "Kode alasan tak dikenal — pilih kode alasan koreksi dari daftar.";

/**
 * Kode alasan KOREKSI yang sah: ada di master `reason_code`, `applies_to =
 * 'adjustment'`, aktif, dan BUKAN kode pembukuan maju `ADJ-FWD-*` (diisi sistem).
 * Dibaca lewat klien transaksi pemanggil.
 */
export async function kodeAlasanKoreksiSah(
  c: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[] }> },
  code: string,
): Promise<boolean> {
  const rc = await c.query(
    `SELECT code FROM app.reason_code
      WHERE code = $1 AND applies_to = 'adjustment' AND active AND code NOT LIKE 'ADJ-FWD-%'`,
    [code],
  );
  return rc.rows.length > 0;
}
