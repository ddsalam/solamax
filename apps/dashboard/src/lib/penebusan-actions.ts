"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { senKeTeks } from "./antar-unit-model";
import { hariBukuTerkunci } from "./hari-buku-queries";
import {
  PESAN_TAK_BOLEH_INPUT,
  alasanTakBolehInput,
  canBatalkanPenebusan,
  canCatatPenebusan,
} from "./keuangan-wewenang";
import {
  KATEGORI_PENEBUSAN,
  KODE_MAJU_PENEBUSAN,
  keteranganKasPenebusan,
  periksaPenebusan,
  pilihKandidat,
  type KandidatKas,
  type MasukanPenebusan,
} from "./penebusan-model";
import { rupiahKeSen, teksKeSen } from "./pihak-lawan-model";
import { bacaMutasiId } from "./cocok-bank-queries";
import { audit as auditCocok, buatKelompok, tambahAnggota } from "./cocok-bank-tulis";
import { getDataScope } from "./scope";

/**
 * Server action penebusan per SO (rencana 2026-10-29 U7; R10, R26, R28, R29;
 * KTD5, KTD9). Tindakan BERNAMA:
 *
 *   · catat penebusan    → Keuangan (`canCatatPenebusan`)
 *   · batalkan penebusan → Keuangan (`canBatalkanPenebusan`), hanya hari terbuka
 *
 * Pola `pecahMutasi` / `catatAntarUnit`: gerbang (`requireUnit` + predikat) &
 * validasi angka SEBELUM `pool.connect()`; satu transaksi; `set_config`
 * transaction-local; `hariBukuTerkunci` DI DALAM transaksi sebelum INSERT baris
 * kas. Tanpa DELETE.
 *
 * ⛔ PENEBUSAN MEMILIKI BARIS KASNYA (KTD9, R29). Simpan = satu transaksi:
 *   1. baris kas "Pembelian BBM" yang SUDAH ada (rekening sama, nominal −Gross,
 *      hari buku atau tanggal asal = tanggal bayar, belum diikat) tepat satu ⇒
 *      DIIKAT, tak ada baris baru (mis. diketik manual sejak 1 Okt);
 *   2. dua atau lebih ⇒ ditolak dengan daftar kandidatnya; Keuangan memilih
 *      (`cashLedgerId`) — tak pernah ditebak;
 *   3. tidak ada ⇒ baris kas kredit −Gross dibuat di hari buku U2 (R28).
 * Mengikat TIDAK menyunting baris kas (tautannya hidup di `app.penebusan`),
 * jadi boleh atas baris di hari yang sudah ditutup.
 *
 * ⛔ HPP / harga beli / laba tidak disentuh (R14) — hanya `cash_ledger`,
 * `penebusan`, dan `audit_log` yang ditulis.
 */

export type PenebusanResult =
  | { ok: true; pesan: string; penebusanId: string; cashLedgerId: string; diikat: boolean; hariBuku: string }
  | { ok: false; error: string; kandidat?: KandidatKas[] };

export type BatalPenebusanResult = { ok: true; pesan: string } | { ok: false; error: string };

export interface SimpanPenebusanInput extends MasukanPenebusan {
  code: string;
  /** Baris kas yang dipilih Keuangan saat kandidatnya lebih dari satu. */
  cashLedgerId?: string | null;
  /**
   * U11 (R11) — penebusan dibuka dari debit rekening koran. SO, tanggal bayar,
   * rekening, dan Gross DIBACA ULANG dari baris impor di server (yang dikirim
   * peramban diabaikan); baris kasnya (diikat atau dibuat) dan baris impor
   * diikat satu kelompok cocok dalam transaksi yang sama (KTD6).
   */
  mutasiBankId?: string | null;
}

const halaman = (code: string): string => `/keuangan/unit/${code}/penebusan`;

async function batal(client: { query: (s: string) => Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Catat penebusan (R10, R29)
// ---------------------------------------------------------------------------

export async function simpanPenebusan(input: SimpanPenebusanInput): Promise<PenebusanResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis
  const ctx = { role: scope.role, email: scope.email };
  if (!canCatatPenebusan(ctx)) {
    return { ok: false, error: PESAN_TAK_BOLEH_INPUT[alasanTakBolehInput(ctx) ?? "bukan_keuangan"] };
  }

  const mutasiBankId = input.mutasiBankId ?? null;
  if (mutasiBankId !== null && !UUID_RE.test(mutasiBankId)) return { ok: false, error: "Baris rekening koran tak dikenali — muat ulang halaman." };
  // U11 (R11): dibuka dari baris impor ⇒ Gross dari peramban DIABAIKAN — di
  // sini cukup bentuk komponennya (Gross sementara = Σ komponen); Gross yang
  // berlaku dibaca dari baris impor di dalam transaksi dan diperiksa ulang.
  if (mutasiBankId !== null) {
    const s = [input.net, input.ppn, input.pph, input.pbbkb, input.nota].map((x) => rupiahKeSen(x));
    if (s.every((x): x is number => x !== null)) input = { ...input, gross: s.reduce((a, b) => a + b, 0) / 100 };
  }

  // Angka dibaca ulang & diperiksa di server dalam SEN BULAT (R10).
  let cek = periksaPenebusan(input);
  if (!cek.ok) return { ok: false, error: cek.error };
  const pilihan = input.cashLedgerId ?? null;
  if (pilihan !== null && !UUID_RE.test(pilihan)) return { ok: false, error: "Pilihan baris kas tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // 0. U11 (R11): dibuka dari baris impor ⇒ SO, tanggal, rekening, Gross
    //    dari BARIS IMPOR (dibaca ulang sesudah rekening korannya dikunci),
    //    bukan dari peramban. Komponen pajak diperiksa ulang terhadap Gross itu.
    if (mutasiBankId !== null) {
      const awal = await bacaMutasiId(client, unit.unit_id, [mutasiBankId]);
      if (awal.length === 1) {
        await client.query(
          `SELECT id FROM app.rekening_koran WHERE unit_id = $1 AND id = $2::uuid FOR NO KEY UPDATE`,
          [unit.unit_id, awal[0]!.rekeningKoranId],
        );
      }
      const [m] = await bacaMutasiId(client, unit.unit_id, [mutasiBankId]);
      const tolakBaris =
        !m ? "Baris rekening koran tak ditemukan di unit ini — muat ulang halaman."
        : m.rkStatus !== "aktif" ? "Rekening koran baris ini sudah ditarik."
        : m.praCutover ? "Baris ini bertanggal sebelum cut-over — tidak dibukukan (R22)."
        : m.dicocokkan ? "Baris rekening koran ini sudah diselesaikan — muat ulang halaman."
        : m.amountSen >= 0 ? "Penebusan hanya untuk DEBIT rekening koran."
        : null;
      if (tolakBaris !== null) {
        await batal(client);
        return { ok: false, error: tolakBaris };
      }
      input = {
        ...input,
        noSo: m!.so ?? input.noSo,
        tanggalBayar: m!.tanggalBank,
        accountId: m!.accountId,
        gross: -m!.amountSen / 100,
      };
      cek = periksaPenebusan(input);
      if (!cek.ok) {
        await batal(client);
        return { ok: false, error: `${cek.error} (Gross dari rekening koran.)` };
      }
    }
    const { noSo, noSoTampil, sen } = cek;
    const grossKredit = senKeTeks(-sen.gross);

    // 1. Rekening: milik unit ini, rekening BANK, aktif — dikunci sampai COMMIT.
    const akun = await client.query<{ id: string; nama: string; kind: string; active: boolean }>(
      `SELECT id::text AS id, nama, kind::text AS kind, active
         FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2
        FOR SHARE`,
      [input.accountId, unit.unit_id],
    );
    const a = akun.rows[0];
    if (!a) {
      await batal(client);
      return { ok: false, error: "Rekening tak ditemukan di unit ini — pilih rekening bank milik unit ini." };
    }
    if (a.kind !== "bank") {
      await batal(client);
      return { ok: false, error: `“${a.nama}” bukan rekening bank — penebusan dibayar dari rekening bank.` };
    }
    if (!a.active) {
      await batal(client);
      return { ok: false, error: `Rekening “${a.nama}” sudah ditutup — pilih rekening aktif.` };
    }

    // 2. SO ganda di unit ini (indeks unik 0050 juga menolak, tanpa pesan).
    const ganda = await client.query<{ tanggalBayar: string }>(
      `SELECT to_char(tanggal_bayar,'YYYY-MM-DD') AS "tanggalBayar"
         FROM app.penebusan
        WHERE unit_id = $1 AND no_so = $2 AND NOT void`,
      [unit.unit_id, noSo],
    );
    if (ganda.rows[0]) {
      await batal(client);
      return {
        ok: false,
        error:
          `SO ${noSoTampil} sudah tercatat (dibayar ${ganda.rows[0].tanggalBayar}). Satu SO = satu penebusan; ` +
          `bila dibayar dua kali, batalkan yang lama dan catat ulang dengan Gross gabungannya.`,
      };
    }

    // 3. Kandidat baris kas yang bisa DIIKAT — dikunci FOR UPDATE supaya
    //    pembatalan/pengikatan bersamaan menunggu dan dibaca ulang.
    const kand = await client.query<{
      id: string;
      businessDate: string;
      tanggalAsal: string | null;
      keterangan: string;
      amount: string;
    }>(
      `SELECT l.id::text AS id,
              to_char(l.business_date,'YYYY-MM-DD') AS "businessDate",
              to_char(l.tanggal_asal,'YYYY-MM-DD')  AS "tanggalAsal",
              l.keterangan, l.amount::text AS amount
         FROM app.cash_ledger l
        WHERE l.unit_id = $1 AND l.account_id = $2::uuid AND NOT l.void
          AND l.jenis = 'kredit' AND l.category_label = 'Pembelian BBM'
          AND l.amount = $3::numeric
          AND (l.business_date = $4::date OR l.tanggal_asal = $4::date)
          AND NOT EXISTS (
            SELECT 1 FROM app.penebusan p
             WHERE p.cash_ledger_id = l.id AND p.unit_id = l.unit_id AND NOT p.void
          )
        ORDER BY l.created_at
        FOR UPDATE OF l`,
      [unit.unit_id, input.accountId, grossKredit, input.tanggalBayar],
    );
    const kandidat: KandidatKas[] = kand.rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate,
      tanggalAsal: r.tanggalAsal,
      keterangan: r.keterangan,
      amountSen: teksKeSen(r.amount),
    }));
    const ikat = pilihKandidat(kandidat, pilihan);
    if (ikat.aksi === "tolak") {
      await batal(client);
      return { ok: false, error: ikat.error };
    }
    if (ikat.aksi === "pilih") {
      await batal(client);
      return {
        ok: false,
        error:
          `Ada ${ikat.kandidat.length} baris kas Pembelian BBM sebesar Gross ini di rekening & tanggal yang sama. ` +
          `Pilih yang dibayar untuk SO ${noSoTampil} — sistem tidak menebak.`,
        kandidat: ikat.kandidat,
      };
    }

    // 4. Baris kas: ikat yang ada, atau buat di hari buku U2 (R28). Dari baris
    //    impor (U11) baris kas ini TIDAK ditandai `lahir_dari_cocok_id`:
    //    penebusan MEMILIKI baris kasnya (KTD9). Membatalkan cocoknya hanya
    //    melepas tautan — baris kas & penebusan tetap, dan pencocok SO
    //    menemukannya lagi; membatalkan penebusannya lewat `batalkanPenebusan`.
    const aktor = { userId: scope.userId, email: scope.email };
    const cocokId = mutasiBankId === null ? null : await buatKelompok(client, { unitId: unit.unit_id, cara: "manual", aktor });
    let cashLedgerId: string;
    let hariBuku: string;
    const kasDibuat = ikat.aksi === "buat";
    if (ikat.aksi === "ikat") {
      cashLedgerId = ikat.id;
      const k = kandidat.find((x) => x.id === ikat.id)!;
      hariBuku = k.businessDate;
    } else {
      const hari = await hariBukuTerkunci(client, unit.unit_id, input.tanggalBayar, { accountId: input.accountId });
      if (hari.status === "pra-cut-over") {
        await batal(client);
        return {
          ok: false,
          error:
            `Tanggal bayar mendahului saldo pembuka rekening ini (${hari.cutOver}) — pembayarannya sudah termuat ` +
            `di saldo pembuka, jadi baris kasnya tidak dibukukan. Mencatatnya akan menghitungnya dua kali.`,
        };
      }
      const maju = hari.perluKodeAlasan;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis,
            category_side, category_label, amount, created_by_user_id,
            tanggal_asal, alasan_maju, alasan_maju_applies_to)
         VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
                 $6::app.cash_mutation_side,$7,$8::numeric,$9,
                 $10::date,$11,$12)
         RETURNING id::text AS id`,
        [
          unit.unit_id,
          input.accountId,
          hari.hariBuku,
          keteranganKasPenebusan(noSoTampil),
          "kredit",
          "kredit",
          KATEGORI_PENEBUSAN,
          grossKredit,
          scope.userId,
          maju ? input.tanggalBayar : null,
          maju ? KODE_MAJU_PENEBUSAN : null,
          maju ? "adjustment" : null,
        ],
      );
      cashLedgerId = ins.rows[0]?.id ?? "?";
      hariBuku = hari.hariBuku;
    }

    // 5. Penebusan — CHECK 0050 menegakkan Σ = Gross sekali lagi di DB.
    const pnb = await client.query<{ id: string }>(
      `INSERT INTO app.penebusan
         (unit_id, no_so, tanggal_bayar, account_id, net, ppn, pph, pbbkb, nota, gross,
          cash_ledger_id, kas_dibuat, created_by_user_id)
       VALUES ($1,$2,$3::date,$4::uuid,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,
               $11::uuid,$12,$13)
       RETURNING id::text AS id`,
      [
        unit.unit_id,
        noSo,
        input.tanggalBayar,
        input.accountId,
        senKeTeks(sen.net),
        senKeTeks(sen.ppn),
        senKeTeks(sen.pph),
        senKeTeks(sen.pbbkb),
        senKeTeks(sen.nota),
        senKeTeks(sen.gross),
        cashLedgerId,
        kasDibuat,
        scope.userId,
      ],
    );
    const penebusanId = pnb.rows[0]?.id ?? "?";

    // 6. U11: baris impor ↔ baris kas penebusan, satu kelompok (Σ = 0 — Gross
    //    dibaca dari baris impor itu sendiri).
    if (cocokId !== null) {
      await tambahAnggota(client, { unitId: unit.unit_id, cocokId, mutasiIds: [mutasiBankId!], kasIds: [cashLedgerId] });
      await auditCocok(client, aktor, "klasifikasi.penebusan", `${unit.code}/${cocokId}`, {
        mutasi: [mutasiBankId],
        kas: [cashLedgerId],
        penebusanId,
        kasDibuat,
        hariBuku,
      });
    }

    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        scope.userId,
        scope.email,
        "penebusan.catat",
        `${unit.code}/${penebusanId}`,
        JSON.stringify({
          noSo,
          tanggalBayar: input.tanggalBayar,
          rekening: input.accountId,
          komponen: Object.fromEntries(Object.entries(sen).map(([k, v]) => [k, senKeTeks(v)])),
          cashLedgerId,
          kasDibuat,
          hariBuku,
          mutasiBankId,
          cocokId,
        }),
      ],
    );
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    if (cocokId !== null) revalidatePath(`/keuangan/unit/${unit.code}/impor-bank`);
    revalidatePath(`/keuangan/unit/${unit.code}/${hariBuku}/input`);
    return {
      ok: true,
      pesan: kasDibuat
        ? `Penebusan SO ${noSoTampil} tersimpan; baris kas Pembelian BBM dibukukan ${hariBuku}.`
        : `Penebusan SO ${noSoTampil} tersimpan dan diikat ke baris kas yang sudah ada (${hariBuku}).`,
      penebusanId,
      cashLedgerId,
      diikat: !kasDibuat,
      hariBuku,
    };
  } catch (e) {
    await batal(client);
    const kode = (e as { code?: string; constraint?: string } | null)?.code;
    const constraint = (e as { constraint?: string } | null)?.constraint;
    if (kode === "23505" && constraint === "penebusan_so_aktif_uq") {
      return { ok: false, error: `SO ${input.noSo.trim()} baru saja dicatat bersamaan — muat ulang halaman.` };
    }
    if (kode === "23505" && (constraint === "cocok_bank_baris_mutasi_aktif_uq" || constraint === "cocok_bank_baris_kas_aktif_uq")) {
      return { ok: false, error: "Baris rekening koran atau baris kasnya baru saja dicocokkan bersamaan — muat ulang halaman." };
    }
    if (kode === "23505" && constraint === "penebusan_cash_ledger_aktif_uq") {
      return { ok: false, error: "Baris kas itu baru saja diikat ke penebusan lain — muat ulang halaman." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan penebusan." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Batalkan penebusan — hanya bila hari buku baris kasnya masih terbuka
// ---------------------------------------------------------------------------

export async function batalkanPenebusan(input: { code: string; id: string }): Promise<BatalPenebusanResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canBatalkanPenebusan(ctx)) {
    return { ok: false, error: PESAN_TAK_BOLEH_INPUT[alasanTakBolehInput(ctx) ?? "bukan_keuangan"] };
  }
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Penebusan tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const r = await client.query<{
      id: string;
      noSo: string;
      kasDibuat: boolean;
      cashLedgerId: string;
      businessDate: string;
      accountId: string;
    }>(
      `SELECT p.id::text AS id, p.no_so AS "noSo", p.kas_dibuat AS "kasDibuat",
              p.cash_ledger_id::text AS "cashLedgerId",
              to_char(l.business_date,'YYYY-MM-DD') AS "businessDate",
              l.account_id::text AS "accountId"
         FROM app.penebusan p
         JOIN app.cash_ledger l ON l.id = p.cash_ledger_id AND l.unit_id = p.unit_id
        WHERE p.id = $1::uuid AND p.unit_id = $2 AND NOT p.void
        FOR UPDATE OF p, l`,
      [input.id, unit.unit_id],
    );
    const p = r.rows[0];
    if (!p) {
      await batal(client);
      return { ok: false, error: "Penebusan sudah dibatalkan atau tak ditemukan — muat ulang halaman." };
    }

    // ⛔ U10 — tolak bila baris kas `p.cashLedgerId` ada di kelompok cocok
    //    AKTIF ("batalkan cocok dulu" — milik HoF, R31). Baris kasnya sudah
    //    dikunci FOR UPDATE di atas; pencocok mengunci baris kas yang sama
    //    sebelum menautkannya, jadi periksa ini tidak bisa disalip.
    const cocok = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.cocok_bank_baris
        WHERE cash_ledger_id = $1::uuid AND unit_id = $2 AND aktif`,
      [p.cashLedgerId, unit.unit_id],
    );
    if ((cocok.rows[0]?.n ?? 0) > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          "Baris kas penebusan ini sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan " +
          "cocoknya dulu, baru penebusan bisa dibatalkan.",
      };
    }

    // Hari buku baris kas harus masih terbuka — dikunci bersama sampai COMMIT
    // sehingga penutupan hari menunggu (KTD5). Hari tertutup ⇒ pembalikan maju.
    const hari = await hariBukuTerkunci(client, unit.unit_id, p.businessDate, { accountId: p.accountId });
    if (hari.status === "pra-cut-over" || hari.hariBuku !== p.businessDate) {
      await batal(client);
      return {
        ok: false,
        error:
          `Hari buku baris kas penebusan ini (${p.businessDate}) sudah ditutup — penebusan tidak bisa dibatalkan ` +
          `langsung. Koreksinya lewat pembalikan maju ke hari terbuka (belum tersedia; hubungi Head of Finance).`,
      };
    }

    const v = await client.query(
      `UPDATE app.penebusan
          SET void = true, voided_by_user_id = $1, voided_at = now()
        WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
      [scope.userId, p.id, unit.unit_id],
    );
    if (v.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Penebusan berubah bersamaan — muat ulang halaman." };
    }
    // Baris kas hanya ikut di-void bila DIBUAT penebusan ini; baris manual
    // yang diikat tetap — ia diketik sendiri dan tetap mutasi bank yang nyata.
    if (p.kasDibuat) {
      await client.query(
        `UPDATE app.cash_ledger
            SET void = true, voided_by_user_id = $1, voided_at = now()
          WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
        [scope.userId, p.cashLedgerId, unit.unit_id],
      );
    }
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        scope.userId,
        scope.email,
        "penebusan.batal",
        `${unit.code}/${p.id}`,
        JSON.stringify({ noSo: p.noSo, cashLedgerId: p.cashLedgerId, kasIkutDibatalkan: p.kasDibuat }),
      ],
    );
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    revalidatePath(`/keuangan/unit/${unit.code}/${p.businessDate}/input`);
    return {
      ok: true,
      pesan: p.kasDibuat
        ? "Penebusan dan baris kasnya dibatalkan."
        : "Penebusan dibatalkan; baris kas manual yang diikatnya tetap di buku.",
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan penebusan." };
  } finally {
    client.release();
  }
}
