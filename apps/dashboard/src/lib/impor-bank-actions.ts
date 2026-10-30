"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { jalankanCocokOtomatis } from "./cocok-bank-tulis";
import { pool } from "./db";
import { tentukanHariBuku } from "./hari-buku";
import {
  bandingkanSaldoAwal,
  nomorRekeningSama,
  periksaBerkas,
  periodeAwal,
  type HasilCocokSesudahUnggah,
  type HasilUnggah,
  type SebabTolak,
} from "./impor-bank-model";
import { bacaRekeningKoranBca, GalatRekeningKoran, type RekeningKoran } from "./impor-bank-parser";
import { simpanRekeningKoran } from "./impor-bank-tulis";
import { keSaldoBukuAwal, POLA_NAMA_BCA, SQL_CUT_OVER, SQL_SALDO_BUKU_AWAL, type BarisSaldoBuku } from "./impor-bank-queries";
import {
  pesanTakBolehInput,
  canImporRekeningKoran,
  canTarikRekeningKoran,
} from "./keuangan-wewenang";
import { GalatPdfTeks, teksDariPdf } from "./pdf-teks";
import { getDataScope } from "./scope";
import { bulanTertutupTerkunci } from "./tutup-bulan-queries";
import { auditKeuangan, batal, kodeAlasanKoreksiSah, PESAN_KODE_ALASAN_TAK_DIKENAL } from "./keuangan-tx";
import { PREFIKS_KODE_MAJU } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";

/**
 * Server action impor rekening koran (rencana 2026-10-29 U9; R17–R19, R22,
 * R31; KTD6, KTD10, KTD13). Tindakan BERNAMA:
 *
 *   · unggah rekening koran → Keuangan (`canImporRekeningKoran`)
 *   · tarik rekening koran  → HoF (`canTarikRekeningKoran`)
 *
 * ⛔ UNGGAH DIKERASKAN (Implementation Constraints): `requireUnit` + predikat
 * wewenang SEBELUM berkas disentuh; ukuran diperiksa sebelum dibaca; kepala
 * `%PDF`, `execFile` tanpa shell, batas waktu & halaman di `teksDariPdf`;
 * pembaca U8 menolak UTUH bila kaki tak cocok (AE3) — sebelum koneksi DB apa
 * pun dibuka, jadi berkas yang ditolak tak meninggalkan jejak di DB.
 *
 * ⛔ TIDAK PERNAH menulis `cash_ledger` (KTD6). Baris impor disimpan apa
 * adanya; pencocokan (U10) adalah tautan. Baris bertanggal sebelum cut-over
 * rekening disimpan `pra_cutover = true` (R22, AE8) menurut aturan KTD5
 * (`tentukanHariBuku`) — tak pernah dicocokkan, tak pernah dibukukan.
 *
 * ⛔ Idempoten (R19): berkas identik (sha256) untuk (rekening, bulan) yang
 * aktif = no-op "sudah ada"; berkas BERBEDA ditolak sampai HoF menarik yang
 * lama. Partial unique 0051 menjamin yang sama bila dua unggahan berbalapan.
 */

const halaman = (code: string): string => `/keuangan/unit/${code}/impor-bank`;

const tolak = (sebab: SebabTolak, pesan: string): HasilUnggah => ({ status: "ditolak", sebab, pesan });

const PESAN_PERIODE_AKTIF = (periode: string): string =>
  `Rekening koran ${periode} untuk rekening ini sudah diimpor dari berkas yang BERBEDA. ` +
  "Tarik impor lama dulu: bila berkas lama keliru, minta Head of Finance menariknya, lalu unggah ulang berkas ini.";

/** Galat unik Postgres dari partial unique 0051 — dua unggahan berbalapan. */
function tabrakanAktif(e: unknown): boolean {
  const g = e as { code?: string; constraint?: string } | null;
  return g?.code === "23505" && (g.constraint === "rekening_koran_aktif_uq" || g.constraint === "mutasi_bank_aktif_uq");
}

async function cocokSesudahUnggah(
  client: PoolClient,
  m: Parameters<typeof jalankanCocokOtomatis>[1],
): Promise<HasilCocokSesudahUnggah> {
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(m.unitId)]);
    const h = await jalankanCocokOtomatis(client, m);
    if (!h.ok) {
      await batal(client);
      return { status: "gagal", pesan: `Impor tersimpan, tetapi cocok otomatis tidak berjalan: ${h.error}` };
    }
    await client.query("COMMIT");
    return { status: "selesai", nOtomatis: h.nOtomatis, nBanyak: h.nBanyak, nTanpa: h.nTanpa };
  } catch (e) {
    await batal(client);
    return {
      status: "gagal",
      pesan:
        "Impor tersimpan, tetapi cocok otomatis gagal — jalankan ulang “Cocokkan otomatis”. " +
        (e instanceof Error ? e.message : ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Unggah (R17, R18, R19, R22)
// ---------------------------------------------------------------------------

export async function unggahRekeningKoran(form: FormData): Promise<HasilUnggah> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(String(form.get("code") ?? "")); // di luar scope → notFound()
  const ctx = { role: scope.role, email: scope.email };
  if (!canImporRekeningKoran(ctx)) {
    return tolak("wewenang", pesanTakBolehInput(ctx));
  }
  const accountId = String(form.get("accountId") ?? "");
  if (!UUID_RE.test(accountId)) return tolak("rekening-salah", "Rekening tak dikenali — muat ulang halaman.");

  // ── Berkas baru disentuh SESUDAH gerbang di atas ──────────────────────────
  const berkas = form.get("berkas");
  if (!(berkas instanceof Blob)) return tolak("berkas", "Pilih berkas e-statement PDF dari BCA.");
  const salahUkuran = periksaBerkas(berkas.size);
  if (salahUkuran !== null) return tolak("berkas", salahUkuran);
  const isi = Buffer.from(await berkas.arrayBuffer());

  let rk: RekeningKoran;
  try {
    rk = bacaRekeningKoranBca(await teksDariPdf(isi));
  } catch (e) {
    if (e instanceof GalatPdfTeks) return tolak("berkas", e.message);
    if (e instanceof GalatRekeningKoran) {
      return e.kode === "kaki-tidak-cocok"
        ? { status: "ditolak-kaki", pesan: e.message, ketidakcocokan: e.ketidakcocokan }
        : tolak("format", e.message);
    }
    throw e;
  }
  const sha256 = createHash("sha256").update(isi).digest("hex");
  const hariPertama = periodeAwal(rk.periode);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // 1. Rekening: milik unit ini, BANK BCA aktif bernomor, nomornya = kepala (R18).
    const akun = await client.query<{
      id: string;
      nama: string;
      kind: string;
      active: boolean;
      nomorRekening: string | null;
      bca: boolean;
    }>(
      `SELECT id::text AS id, nama, kind::text AS kind, active, nomor_rekening AS "nomorRekening",
              (nama ~* $3) AS bca
         FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2
        FOR SHARE`,
      [accountId, unit.unit_id, POLA_NAMA_BCA],
    );
    const a = akun.rows[0];
    const salahRekening =
      !a
        ? "Rekening tak ditemukan di unit ini — pilih rekening BCA milik unit ini."
        : a.kind !== "bank" || !a.bca
          ? `“${a.nama}” bukan rekening BCA — impor tahap ini hanya e-statement BCA; rekening bank lain tetap diketik manual.`
          : !a.active
            ? `Rekening “${a.nama}” sudah ditutup — impor hanya untuk rekening aktif.`
            : a.nomorRekening === null
              ? `Rekening “${a.nama}” belum punya nomor rekening — isi dulu di Kelola akun kas.`
              : !nomorRekeningSama(rk.nomorRekening, a.nomorRekening)
                ? `Rekening salah: berkas ini milik rekening ${rk.nomorRekening}, sedangkan rekening yang dipilih ` +
                  `“${a.nama}” bernomor ${a.nomorRekening}. Pilih baris rekening yang benar, atau periksa berkasnya.`
                : null;
    if (salahRekening !== null) {
      await batal(client);
      return tolak("rekening-salah", salahRekening);
    }

    // 2. Rekening koran AKTIF untuk (rekening, bulan) ini — identik = no-op.
    const ada = await client.query<{ id: string; fileSha256: string; nBaris: number; nPraCutover: number }>(
      `SELECT r.id::text AS id, r.file_sha256 AS "fileSha256",
              (SELECT count(*)::int FROM app.mutasi_bank m
                WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id) AS "nBaris",
              (SELECT count(*)::int FROM app.mutasi_bank m
                WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id AND m.pra_cutover) AS "nPraCutover"
         FROM app.rekening_koran r
        WHERE r.unit_id = $1 AND r.account_id = $2::uuid AND r.periode = $3::date AND r.status = 'aktif'`,
      [unit.unit_id, accountId, hariPertama],
    );
    const lama = ada.rows[0];
    if (lama) {
      await batal(client);
      if (lama.fileSha256 === sha256) {
        return { status: "sudah-ada", rekeningKoranId: lama.id, periode: rk.periode, nBaris: lama.nBaris, nPraCutover: lama.nPraCutover };
      }
      return tolak("periode-aktif", PESAN_PERIODE_AKTIF(rk.periode));
    }

    // 2b. Bulan tertutup ⇒ tolak (keputusan Dion 30 Okt 2026, §10.43). Sama
    // dengan tarik: kunci BERSAMA bulan dulu, baru `tutup_bulan` dibaca, jadi
    // penutup yang berjalan ditunggu dan penutup sesudahnya melihat impor ini.
    // Sesudah cek identik di atas: unggah ulang berkas yang sama tetap no-op.
    if ((await bulanTertutupTerkunci(client, unit.unit_id, [rk.periode])).length > 0) {
      await batal(client);
      return tolak(
        "bulan-tertutup",
        `Bulan ${rk.periode} sudah ditutup — rekening koran bulan tertutup tidak bisa diunggah. ` +
          "Bulan tertutup tidak dibuka kembali; hubungi Head of Finance.",
      );
    }

    // 3. Cut-over rekening (⇒ unit) — satu aturan tanggal buku (KTD5, R22).
    const cut = await client.query<{ unit: string | null; akun: string | null }>(SQL_CUT_OVER, [unit.unit_id, accountId]);
    const cutOver = cut.rows[0]?.akun ?? cut.rows[0]?.unit ?? null;
    const pra = rk.rows.map((r) => tentukanHariBuku({ tanggal: r.tanggal, cutOver, tertutup: [] }).status === "pra-cut-over");

    // 4. Rekening koran + barisnya, satu transaksi (satu salinan SQL: impor-bank-tulis.ts).
    const rekeningKoranId = await simpanRekeningKoran(client, {
      unitId: unit.unit_id,
      accountId,
      hariPertama,
      rk,
      sha256,
      pra,
      userId: scope.userId,
    });

    // 5. R18 — saldo awal vs saldo buku hari sebelum periode (menurut tanggal asal).
    const sb = await client.query<BarisSaldoBuku>(SQL_SALDO_BUKU_AWAL, [unit.unit_id, accountId, hariPertama]);
    const saldoAwal = bandingkanSaldoAwal({
      periode: rk.periode,
      saldoAwalSen: rk.saldoAwalSen,
      buku: keSaldoBukuAwal(sb.rows[0]),
      cutOverUnit: cut.rows[0]?.unit ?? null,
    });
    const nPraCutover = pra.filter(Boolean).length;

    await auditKeuangan(client, scope, "rekening_koran.unggah", `${unit.code}/${rekeningKoranId}`, {
      rekening: accountId,
      nomorRekening: rk.nomorRekening,
      periode: rk.periode,
      sha256,
      nBaris: rk.rows.length,
      nPraCutover,
      cutOver,
      saldoAwal,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    // U10 — cocok otomatis SESUDAH impor COMMIT, transaksi sendiri: gagalnya
    // dilaporkan, tak membatalkan impor (baris tetap tersimpan & terbuka; aksi
    // `cocokkanOtomatis` bisa dijalankan ulang). Pengunggah sudah lolos
    // `canImporRekeningKoran` = semantik `canCocokkanBank` (Keuangan).
    const cocok = await cocokSesudahUnggah(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      rekeningKoranId,
      aktor: { userId: scope.userId, email: scope.email },
    });
    return {
      status: "diterima",
      rekeningKoranId,
      periode: rk.periode,
      nBaris: rk.rows.length,
      nPraCutover,
      nCr: rk.footer.nCr,
      nDb: rk.footer.nDb,
      saldoAwal,
      cocok,
    };
  } catch (e) {
    await batal(client);
    if (tabrakanAktif(e)) return tolak("periode-aktif", PESAN_PERIODE_AKTIF(rk.periode));
    return tolak("galat", `Rekening koran tidak tersimpan — tak ada yang diimpor. ${e instanceof Error ? e.message : ""}`.trim());
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Tarik (R31)
// ---------------------------------------------------------------------------

export interface TarikInput {
  code: string;
  rekeningKoranId: string;
  reasonCode: string;
  catatan: string;
}

export type TarikResult = { ok: true; pesan: string } | { ok: false; error: string };

export async function tarikRekeningKoran(input: TarikInput): Promise<TarikResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canTarikRekeningKoran({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh menarik rekening koran yang sudah diimpor." };
  }
  if (!UUID_RE.test(input.rekeningKoranId)) return { ok: false, error: "Rekening koran tak dikenali — muat ulang halaman." };
  const catatan = input.catatan.trim();
  if (catatan === "") return { ok: false, error: "Catatan wajib diisi — tuliskan kenapa impor ini ditarik." };
  const reasonCode = input.reasonCode.trim();
  if (reasonCode === "" || reasonCode.startsWith(PREFIKS_KODE_MAJU)) {
    return { ok: false, error: "Pilih kode alasan koreksi dari daftar (kode pembukuan maju diisi sistem)." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    if (!(await kodeAlasanKoreksiSah(client, reasonCode))) {
      await batal(client);
      return { ok: false, error: PESAN_KODE_ALASAN_TAK_DIKENAL };
    }

    const r = await client.query<{ id: string; status: string; periode: string; accountId: string }>(
      `SELECT id::text AS id, status, to_char(periode, 'YYYY-MM') AS periode, account_id::text AS "accountId"
         FROM app.rekening_koran
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.rekeningKoranId, unit.unit_id],
    );
    const rk = r.rows[0];
    if (!rk) {
      await batal(client);
      return { ok: false, error: "Rekening koran tak ditemukan di unit ini — muat ulang halaman." };
    }
    if (rk.status !== "aktif") {
      await batal(client);
      return { ok: false, error: `Rekening koran ${rk.periode} sudah ditarik sebelumnya.` };
    }

    // U12 (KTD14) — tolak bila bulan `rk.periode` unit ini sudah ditutup.
    // Kunci BERSAMA bulan itu diambil DULU, baru `tutup_bulan` dibaca: penutup
    // yang sedang berjalan ditunggu sampai COMMIT, dan penutup yang datang
    // sesudahnya menunggu tarikan ini lalu melihat rekening korannya hilang.
    const tertutup = await bulanTertutupTerkunci(client, unit.unit_id, [rk.periode]);
    if (tertutup.length > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          `Bulan ${rk.periode} sudah ditutup — rekening koran bulan tertutup tidak bisa ditarik. ` +
          "Koreksinya dibukukan maju ke bulan terbuka.",
      };
    }
    // U10 — tolak bila ada baris rekening koran ini di kelompok cocok AKTIF:
    // "batalkan cocok dulu" (KTD6, R31). Rekening koran sudah dikunci FOR
    // UPDATE di atas, dan setiap pencocok mengunci induknya FOR NO KEY UPDATE —
    // tak ada kelompok baru yang bisa lahir di antara periksa ini dan UPDATE.
    const cocok = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM app.cocok_bank_baris b
         JOIN app.mutasi_bank m ON m.id = b.mutasi_bank_id AND m.unit_id = b.unit_id
        WHERE m.rekening_koran_id = $1::uuid AND m.unit_id = $2 AND b.aktif`,
      [rk.id, unit.unit_id],
    );
    const nCocok = cocok.rows[0]?.n ?? 0;
    if (nCocok > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          `${nCocok} baris rekening koran ${rk.periode} sudah dicocokkan — batalkan cocok dulu ` +
          "(tindakan Head of Finance), baru tarik impornya.",
      };
    }

    // Status → 'ditarik'; `mutasi_bank.rk_status` ikut lewat FK ON UPDATE
    // CASCADE (0051) — baris bank tak pernah disunting aplikasi.
    const u = await client.query(
      `UPDATE app.rekening_koran
          SET status = 'ditarik', ditarik_at = now(), ditarik_by_user_id = $3,
              ditarik_alasan = $4, ditarik_alasan_applies_to = 'adjustment', ditarik_catatan = $5
        WHERE id = $1::uuid AND unit_id = $2 AND status = 'aktif'`,
      [rk.id, unit.unit_id, scope.userId, reasonCode, catatan],
    );
    if (u.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Rekening koran berubah bersamaan — muat ulang halaman." };
    }

    await auditKeuangan(client, scope, "rekening_koran.tarik", `${unit.code}/${rk.id}`, {
      rekening: rk.accountId,
      periode: rk.periode,
      reasonCode,
      catatan,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { ok: true, pesan: `Rekening koran ${rk.periode} ditarik. Berkas pengganti kini boleh diunggah.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menarik rekening koran." };
  } finally {
    client.release();
  }
}
