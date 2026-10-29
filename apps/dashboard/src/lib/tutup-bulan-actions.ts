"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { canTutupBulan } from "./keuangan-wewenang";
import { getDataScope } from "./scope";
import { bacaBahanTutupBulan, kunciBulanEksklusif } from "./tutup-bulan-queries";
import { bulanTutupSah, periksaTutupBulan } from "./tutup-bulan-model";

/**
 * Server action TUTUP BULAN (rencana 2026-10-29 U12; R25; KTD14).
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
 */

export type TutupBulanResult =
  | { ok: true; sudahDitutup: boolean; pesan: string }
  | { ok: false; error: string; alasan?: readonly string[] };

export interface TutupBulanInput {
  code: string;
  /** `YYYY-MM`. */
  bulan: string;
}

async function batal(client: { query: (s: string) => Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
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
    const vonis = periksaTutupBulan(bahan);
    if (!vonis.boleh) {
      await batal(client);
      return { ok: false, error: `Bulan belum bisa ditutup: ${vonis.alasan.join(" ")}`, alasan: vonis.alasan };
    }

    const ins = await client.query(
      `INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (unit_id, bulan) DO NOTHING`,
      [unit.unit_id, `${input.bulan}-01`, scope.userId],
    );
    if (ins.rowCount !== 1) {
      await batal(client);
      return { ok: true, sudahDitutup: true, pesan: `Bulan ${input.bulan} sudah ditutup sebelumnya.` };
    }
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        scope.userId,
        scope.email,
        "tutup_bulan.tutup",
        `${unit.code}/${input.bulan}`,
        JSON.stringify({
          bulan: input.bulan,
          hari: bahan.hariTertutup.length,
          rekening: bahan.rekening.map((r) => r.id),
        }),
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/tutup-bulan/${input.bulan}`);
    return { ok: true, sudahDitutup: false, pesan: `Bulan ${input.bulan} ditutup.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menutup bulan." };
  } finally {
    client.release();
  }
}
