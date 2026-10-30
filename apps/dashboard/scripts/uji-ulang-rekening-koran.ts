/**
 * UJI ULANG rekening koran BCA (rencana 2026-10-29 U13; Success Criteria butir 1)
 * — unggah setiap e-statement PDF ke UNIT FIKTIF di DB tier TESTING, jalankan
 * cocok otomatis, lalu cetak HITUNGAN per status. Tidak pernah ke DB pilot live.
 *
 * Jalan yang dipakai SAMA dengan aksi `unggahRekeningKoran` (yang butuh sesi
 * Auth.js, jadi tak bisa dipanggil dari sini): `teksDariPdf` → parser U8 →
 * `nomorRekeningSama` → `SQL_CUT_OVER` + `tentukanHariBuku` → `simpanRekeningKoran`
 * → `SQL_SALDO_BUKU_AWAL` + `bandingkanSaldoAwal` → `jalankanCocokOtomatis`
 * dalam transaksi sendiri. Penebusan TIDAK diketik (bukti tak ada di DB), jadi
 * debit B2B Pertamina berakhir "penebusan belum diketik" — itu yang diharapkan.
 *
 * ⛔ Hanya HITUNGAN yang dicetak — tak pernah nama pihak, keterangan, nominal,
 *    atau nomor rekening.
 *
 * Menjalankan (butuh `pdftotext`: `brew install poppler`):
 *
 *   cd apps/dashboard
 *   UJI_ULANG_DB_URL="postgresql://dashboard_app:…@127.0.0.1:PORT/solamax?options=-c%20search_path%3Dapp,public" \
 *     ../backend/node_modules/.bin/tsx scripts/uji-ulang-rekening-koran.ts "/path/lokal/Rekening Koran"
 *
 * Pembersihan (WAJIB sesudah laporan disimpan — Definition of Done: data
 * rekening koran ASLI kini ada di DB testing). DELETE di-REVOKE dari aplikasi,
 * jadi koneksinya role PEMILIK `ingest`:
 *
 *   UJI_ULANG_OWNER_DB_URL="postgresql://ingest:…@127.0.0.1:PORT/solamax" \
 *     ../backend/node_modules/.bin/tsx scripts/uji-ulang-rekening-koran.ts --bersihkan
 *
 * Penjaga tier: `system_identifier` DB live ⇒ MENOLAK, apa pun flag-nya. DB
 * testing `solamax-pg-rlsstg` dikenali dari `system_identifier`-nya (pola
 * `akses-efektif.mts`); instance lain (mis. Postgres sekali-pakai lokal) hanya
 * bila `UJI_ULANG_TIER=testing`. URL yang menyebut `solamax-pg` tanpa `-rlsstg`
 * ditolak.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import type { ScopedUnitId } from "../src/lib/scope-rule";

/** Unit fiktif — di luar 7000/8000/8801–8803 yang dipakai uji integrasi. */
const UNIT_ID = 8810;
const UNIT_CODE = "UJI-8810";
const CUT_OVER = "2026-01-01";
/** Aktor sintetis — `uploaded_by_user_id`/`audit_log.actor_user_id` tanpa FK ke users. */
const AKTOR = { userId: 0, email: "uji-ulang-rekening-koran@sintetis.invalid" };

const SYSID_LIVE = "7650126488674766864";
const SYSID_TEST = "7659054651798528016";

function gagal(pesan: string): never {
  console.error(`⛔ ${pesan}`);
  process.exit(1);
}

async function penjagaTier(pool: Pool, url: string): Promise<string> {
  if (/solamax-pg(?!-rlsstg)/i.test(url)) gagal("URL menyebut solamax-pg (pilot live) — skrip ini hanya untuk tier testing.");
  let sysid: string | null = null;
  try {
    sysid = (await pool.query<{ s: string }>("SELECT system_identifier::text AS s FROM pg_control_system()")).rows[0]?.s ?? null;
  } catch {
    sysid = null;
  }
  if (sysid === SYSID_LIVE) gagal("DB ini adalah pilot LIVE solamax-pg (system_identifier) — ditolak.");
  if (sysid === SYSID_TEST) return "TEST solamax-pg-rlsstg";
  if (process.env.UJI_ULANG_TIER === "testing") return `instance tak dikenal (system_identifier=${sysid ?? "?"}), UJI_ULANG_TIER=testing`;
  return gagal(
    `Instance tak dikenal (system_identifier=${sysid ?? "tak terbaca"}). ` +
      "Jalankan hanya di tier testing; untuk Postgres uji lain set UJI_ULANG_TIER=testing.",
  );
}

const nol = <K extends string>(ks: readonly K[]): Record<K, number> =>
  Object.fromEntries(ks.map((k) => [k, 0])) as Record<K, number>;

// ---------------------------------------------------------------------------
// Pembersihan — role pemilik, urutan dependensi, satu transaksi
// ---------------------------------------------------------------------------

/** Anak dulu. `cash_ledger` sebelum `cocok_bank` (FK `lahir_dari_cocok_id`). */
const URUTAN_HAPUS = [
  "cocok_bank_baris",
  "manual_entry",
  "penebusan",
  "cash_ledger",
  "cocok_bank",
  "mutasi_bank",
  "rekening_koran",
  "edc_settlement",
  "day_close",
  "pihak_lawan_saldo_awal",
  "pihak_lawan",
  "cash_account",
] as const;

async function bersihkan(): Promise<void> {
  const url = process.env.UJI_ULANG_OWNER_DB_URL;
  if (!url) gagal("UJI_ULANG_OWNER_DB_URL belum di-set (role pemilik `ingest`).");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    console.log(`# instance: ${await penjagaTier(pool, url)}`);
    const c = await pool.connect();
    try {
      const role = (await c.query<{ r: string }>("SELECT current_user AS r")).rows[0]?.r;
      if (role !== "ingest") gagal(`Pembersihan butuh role pemilik \`ingest\` (DELETE di-REVOKE dari aplikasi); kini \`${role}\`.`);
      await c.query("BEGIN");
      // FORCE RLS berlaku juga bagi pemilik — tanpa GUC, DELETE menyentuh NOL baris tanpa galat.
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT_ID)]);
      for (const t of URUTAN_HAPUS) {
        const ada = (await c.query<{ ada: boolean }>("SELECT to_regclass($1) IS NOT NULL AS ada", [`app.${t}`])).rows[0]?.ada;
        if (!ada) continue;
        // `manual_entry_immutable_after_close` adalah BEFORE DELETE yang mengembalikan NEW
        // (= NULL pada DELETE) ⇒ Postgres diam-diam MELEWATI setiap DELETE. Matikan hanya
        // di dalam transaksi ini (pemilik tabel; ikut COMMIT/ROLLBACK).
        const lewatiTrigger = t === "manual_entry";
        if (lewatiTrigger) await c.query("ALTER TABLE app.manual_entry DISABLE TRIGGER manual_entry_immutable_after_close");
        const r = await c.query(`DELETE FROM app.${t} WHERE unit_id = $1`, [UNIT_ID]);
        if (lewatiTrigger) await c.query("ALTER TABLE app.manual_entry ENABLE TRIGGER manual_entry_immutable_after_close");
        console.log(`  ${t.padEnd(24)} ${r.rowCount ?? 0}`);
      }
      const a = await c.query("DELETE FROM app.audit_log WHERE target LIKE $1", [`${UNIT_CODE}/%`]);
      console.log(`  ${"audit_log".padEnd(24)} ${a.rowCount ?? 0}`);

      // Sisa di tabel `app.*` lain yang punya unit_id (mis. tabel tutup bulan U12) ⇒ batal, sebut tabelnya.
      const tabel = (
        await c.query<{ t: string }>(
          `SELECT table_name AS t FROM information_schema.columns
            WHERE table_schema = 'app' AND column_name = 'unit_id'
              AND table_name IN (SELECT table_name FROM information_schema.tables
                                  WHERE table_schema = 'app' AND table_type = 'BASE TABLE')
            ORDER BY 1`,
        )
      ).rows.map((r) => r.t);
      const sisa: string[] = [];
      for (const t of tabel) {
        const n = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.${t} WHERE unit_id = $1`, [UNIT_ID])).rows[0]?.n ?? 0;
        if (n > 0) sisa.push(`${t}=${n}`);
      }
      if (sisa.length > 0) {
        await c.query("ROLLBACK");
        gagal(`Masih ada baris unit ${UNIT_ID} di: ${sisa.join(", ")} — tambahkan ke URUTAN_HAPUS. Tak ada yang dihapus.`);
      }
      await c.query("COMMIT");
      console.log(`✅ unit fiktif ${UNIT_ID} bersih.`);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Uji ulang
// ---------------------------------------------------------------------------

async function ujiUlang(dir: string): Promise<void> {
  const url = process.env.UJI_ULANG_DB_URL;
  if (!url) gagal("UJI_ULANG_DB_URL belum di-set (role aplikasi `dashboard_app` di tier testing).");
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) gagal(`Bukan direktori: ${dir}`);
  // `db.ts` membuat pool saat dimuat dari DATABASE_URL — pasang SEBELUM impor dinamis.
  process.env.DATABASE_URL = url;

  const { pool } = await import("../src/lib/db");
  const { teksDariPdf, GalatPdfTeks } = await import("../src/lib/pdf-teks");
  const { bacaRekeningKoranBca, GalatRekeningKoran } = await import("../src/lib/impor-bank-parser");
  const { bandingkanSaldoAwal, nomorRekeningSama, periksaBerkas, periodeAwal } = await import("../src/lib/impor-bank-model");
  const { keSaldoBukuAwal, SQL_CUT_OVER, SQL_SALDO_BUKU_AWAL } = await import("../src/lib/impor-bank-queries");
  const { tentukanHariBuku } = await import("../src/lib/hari-buku");
  const { simpanRekeningKoran } = await import("../src/lib/impor-bank-tulis");
  const { audit, jalankanCocokOtomatis } = await import("../src/lib/cocok-bank-tulis");
  const { bacaKonteksCocok, bacaMutasiRekeningKoran } = await import("../src/lib/cocok-bank-queries");
  const { usulkanSemua } = await import("../src/lib/cocok-bank-model");
  const { senKeTeks } = await import("../src/lib/antar-unit-model");
  type RekeningKoran = import("../src/lib/impor-bank-parser").RekeningKoran;
  type BarisSaldoBuku = import("../src/lib/impor-bank-queries").BarisSaldoBuku;

  const U = UNIT_ID as ScopedUnitId;
  try {
    console.log(`# instance: ${await penjagaTier(pool, url)}`);

    const transaksi = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT_ID)]);
        const h = await fn(c);
        await c.query("COMMIT");
        return h;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };

    // 1. Baca & periksa setiap berkas lebih dulu — nomor rekening ditentukan dari kepalanya.
    const STATUS = ["diterima", "sudah-ada", "ditolak-kaki", "ditolak-format", "ditolak-berkas", "ditolak-periode-aktif", "galat"] as const;
    const berkas = nol(STATUS);
    const terbaca: { rk: RekeningKoran; sha256: string }[] = [];
    const pdf = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
    if (pdf.length === 0) gagal("Tak ada berkas .pdf di direktori itu.");
    for (const f of pdf) {
      const isi = readFileSync(join(dir, f));
      if (periksaBerkas(isi.length) !== null) {
        berkas["ditolak-berkas"] += 1;
        continue;
      }
      try {
        terbaca.push({ rk: bacaRekeningKoranBca(await teksDariPdf(isi)), sha256: createHash("sha256").update(isi).digest("hex") });
      } catch (e) {
        if (e instanceof GalatPdfTeks) berkas["ditolak-berkas"] += 1;
        else if (e instanceof GalatRekeningKoran) berkas[e.kode === "kaki-tidak-cocok" ? "ditolak-kaki" : "ditolak-format"] += 1;
        else throw e;
      }
    }
    terbaca.sort((a, b) => a.rk.periode.localeCompare(b.rk.periode));

    // 2. Rekening BCA fiktif per nomor di kepala (dipakai ulang bila sudah ada) + saldo pembuka 1 Jan.
    const nomor = [...new Set(terbaca.map((t) => t.rk.nomorRekening))];
    if (nomor.length !== 2) console.log(`⚠️ ${nomor.length} nomor rekening di kepala berkas (diharapkan 2) — dilanjutkan.`);
    const akun = new Map<string, string>(); // nomor → account id
    await transaksi(async (c) => {
      for (const [i, n] of nomor.entries()) {
        const ada = (
          await c.query<{ id: string; nomor: string | null }>(
            `SELECT id::text AS id, nomor_rekening AS nomor FROM app.cash_account WHERE unit_id = $1 AND kind = 'bank'`,
            [UNIT_ID],
          )
        ).rows.find((r) => nomorRekeningSama(r.nomor, n));
        const id =
          ada?.id ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO app.cash_account (unit_id, nama, kind, nomor_rekening)
               VALUES ($1, $2, 'bank', $3) RETURNING id::text AS id`,
              [UNIT_ID, `Bank BCA - ${n}`, n],
            )
          ).rows[0]!.id;
        akun.set(n, id);
        const sa = await c.query(`SELECT 1 FROM app.cash_ledger WHERE unit_id = $1 AND account_id = $2::uuid AND saldo_awal AND NOT void`, [UNIT_ID, id]);
        if (sa.rowCount === 0) {
          const pertama = terbaca.find((t) => t.rk.nomorRekening === n)!.rk;
          if (pertama.periode !== CUT_OVER.slice(0, 7)) console.log(`⚠️ rekening #${i + 1}: berkas terawal ${pertama.periode}, bukan ${CUT_OVER.slice(0, 7)}.`);
          // Saldo pembuka = saldo awal rekening koran terawal (pola `tetapkanSaldoAwal`); nol ⇒ sementara (§10.26).
          await c.query(
            `INSERT INTO app.cash_ledger
               (unit_id, account_id, business_date, keterangan, jenis, amount,
                saldo_awal, saldo_awal_sementara, created_by_user_id)
             VALUES ($1, $2::uuid, $3::date, $4, 'adjustment', $5::numeric, true, $6, $7)`,
            [UNIT_ID, id, CUT_OVER, "Saldo pembuka (uji ulang)", senKeTeks(pertama.saldoAwalSen), pertama.saldoAwalSen === 0, AKTOR.userId],
          );
        }
      }
    });

    // 3. Unggah per berkas — langkah 2–5 `unggahRekeningKoran`, lalu cocok otomatis transaksi sendiri.
    const saldoAwal = nol(["cocok", "selisih", "tanpa-saldo-pembuka", "sebelum-cut-over"] as const);
    let cocokGagal = 0;
    const rkIds: string[] = [];
    for (const { rk, sha256 } of terbaca) {
      const accountId = akun.get(rk.nomorRekening)!;
      const hariPertama = periodeAwal(rk.periode);
      try {
        const hasil = await transaksi(async (c) => {
          const lama = (
            await c.query<{ id: string; sha: string }>(
              `SELECT id::text AS id, file_sha256 AS sha FROM app.rekening_koran
                WHERE unit_id = $1 AND account_id = $2::uuid AND periode = $3::date AND status = 'aktif'`,
              [UNIT_ID, accountId, hariPertama],
            )
          ).rows[0];
          if (lama) return lama.sha === sha256 ? ({ s: "sudah-ada", id: lama.id } as const) : ({ s: "ditolak-periode-aktif" } as const);
          const cut = (await c.query<{ unit: string | null; akun: string | null }>(SQL_CUT_OVER, [UNIT_ID, accountId])).rows[0];
          const cutOver = cut?.akun ?? cut?.unit ?? null;
          const pra = rk.rows.map((r) => tentukanHariBuku({ tanggal: r.tanggal, cutOver, tertutup: [] }).status === "pra-cut-over");
          const id = await simpanRekeningKoran(c, { unitId: U, accountId, hariPertama, rk, sha256, pra, userId: AKTOR.userId });
          const sb = await c.query<BarisSaldoBuku>(SQL_SALDO_BUKU_AWAL, [UNIT_ID, accountId, hariPertama]);
          const banding = bandingkanSaldoAwal({ periode: rk.periode, saldoAwalSen: rk.saldoAwalSen, buku: keSaldoBukuAwal(sb.rows[0]) });
          await audit(c, AKTOR, "rekening_koran.unggah", `${UNIT_CODE}/${id}`, { uji_ulang: true, periode: rk.periode, nBaris: rk.rows.length });
          return { s: "diterima", id, banding: banding.status } as const;
        });
        berkas[hasil.s] += 1;
        if (hasil.s === "ditolak-periode-aktif") continue;
        if (hasil.s === "diterima") saldoAwal[hasil.banding] += 1;
        rkIds.push(hasil.id);
        const cocok = await transaksi((c) =>
          jalankanCocokOtomatis(c, { unitId: U, unitCode: UNIT_CODE, rekeningKoranId: hasil.id, aktor: AKTOR }),
        );
        if (!cocok.ok) cocokGagal += 1;
      } catch {
        berkas.galat += 1; // pesan galat bisa memuat isi baris — tak dicetak
      }
    }

    // 4. Laporan — potret akhir dari DB + usulan baca-saja (tanpa menulis).
    const baris = (
      await transaksi((c) =>
        c.query<{ n: number; pra: number; cr: number; db: number; so: number; soUnik: number; terbuka: number }>(
          `SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE m.pra_cutover)::int AS pra,
                  count(*) FILTER (WHERE m.amount > 0)::int AS cr,
                  count(*) FILTER (WHERE m.amount < 0)::int AS db,
                  count(*) FILTER (WHERE m.amount < 0 AND m.so IS NOT NULL)::int AS so,
                  count(DISTINCT m.so) FILTER (WHERE m.amount < 0 AND m.so IS NOT NULL)::int AS "soUnik",
                  count(*) FILTER (WHERE NOT m.pra_cutover AND NOT EXISTS (
                    SELECT 1 FROM app.cocok_bank_baris b WHERE b.mutasi_bank_id = m.id AND b.unit_id = m.unit_id AND b.aktif
                  ))::int AS terbuka
             FROM app.mutasi_bank m
            WHERE m.unit_id = $1 AND m.rk_status = 'aktif'`,
          [UNIT_ID],
        ),
      )
    ).rows[0]!;
    const jenis = nol(["tunggal", "banyak", "tanpa"] as const);
    const tanda = new Map<string, number>();
    await transaksi(async (c) => {
      for (const id of rkIds) {
        const mutasi = await bacaMutasiRekeningKoran(c, UNIT_ID, id);
        for (const u of usulkanSemua(mutasi, await bacaKonteksCocok(c, UNIT_ID, mutasi))) {
          if (u.tanda === "pra-cutover" || u.tanda === "sudah-dicocokkan" || u.tanda === "ditarik") continue;
          jenis[u.jenis] += 1;
          const k = u.tanda ?? "(tanpa tanda)";
          tanda.set(k, (tanda.get(k) ?? 0) + 1);
        }
      }
    });

    console.log(`\n# Uji ulang rekening koran — unit fiktif ${UNIT_ID}, cut-over ${CUT_OVER}`);
    console.log(`Berkas: ${pdf.length} PDF`);
    for (const k of STATUS) console.log(`  ${k.padEnd(24)} ${berkas[k]}`);
    console.log(`Saldo awal vs buku (berkas diterima):`);
    for (const [k, v] of Object.entries(saldoAwal)) console.log(`  ${k.padEnd(24)} ${v}`);
    console.log(`Baris impor aktif:            ${baris.n}  (CR ${baris.cr} · DB ${baris.db} · pra-cut-over ${baris.pra})`);
    console.log(`Debit Pertamina ber-SO:       ${baris.so}  (SO unik ${baris.soUnik})`);
    console.log(`Cocok otomatis gagal jalan:   ${cocokGagal} rekening koran`);
    console.log(`Usulan baris terbuka:         tunggal ${jenis.tunggal} · banyak ${jenis.banyak} · tanpa ${jenis.tanpa}`);
    for (const [k, v] of [...tanda.entries()].sort()) console.log(`  ${k.padEnd(32)} ${v}`);
    console.log(`Baris terbuka (bukan pra-cut-over, belum di kelompok cocok): ${baris.terbuka}`);
    console.log(`\n⚠️ Data rekening koran ASLI kini di DB testing — jalankan --bersihkan (role ingest) sesudah laporan ini disimpan.`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--bersihkan")) return bersihkan();
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) gagal("Pemakaian: uji-ulang-rekening-koran.ts <direktori PDF BCA> | --bersihkan");
  return ujiUlang(dir);
}

main().catch((e: unknown) => {
  // Hanya jenis & kode galat — pesan Postgres bisa mengutip nilai baris.
  const g = e as { code?: string; constraint?: string; name?: string };
  console.error(`⛔ gagal: ${g.name ?? "Error"} ${g.code ?? ""} ${g.constraint ?? ""}`.trim());
  process.exit(1);
});
