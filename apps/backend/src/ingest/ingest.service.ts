import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { IngestPayload, IngestResponse, TagihanManifest } from "@solamax/shared";
import {
  MAX_TAGIHAN_MANIFEST_KEYS,
  REPLACE_WINDOW_DOMAINS,
  TABLES_BY_DOMAIN,
} from "@solamax/shared";
import { PrismaService } from "../prisma.service.js";
import {
  buildReplace,
  buildReplaceWindowDeletes,
  buildSalesDetailPrune,
  buildTagihanDetailPrune,
  buildTagihanManifestPrune,
  buildUpsert,
  TAGIHAN_MANIFEST_COUNT_SQL,
  TAGIHAN_MANIFEST_STATE_SQL,
  TAGIHAN_TOKEN_SQL,
} from "./sql.js";
import { MAX_ROWS_PER_TABLE, TABLE_CONFIG } from "./table-config.js";
import {
  buildGlWindowPrune, contributesToGl, glContentConfig,
  UPDATE_SYNC_STATE_WITH_GL_REVISION_SQL,
} from "./gl-content-revision.js";
import { SnapshotSourceCaptureService } from "../saldo-pelanggan/source-capture.service.js";

/** Koneksi transaksi yang dipakai jalur ingest (subset Prisma.TransactionClient). */
interface IngestTx {
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
}

const TAGIHAN_TABLES = TABLES_BY_DOMAIN.tagihan as readonly string[];
/** Jumlah kunci berbeda menurut `bpchar` (spasi pengisi di ujung bukan perbedaan). */
const kunciUnik = (keys: readonly string[]) => new Set(keys.map((k) => k.trimEnd())).size;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly snapshotCapture?: SnapshotSourceCaptureService,
  ) {}

  /**
   * UPSERT seluruh tabel payload + update sync_state dalam SATU transaksi —
   * header+detail satu commit; watermark tercatat hanya bila data ter-commit
   * (atomik by construction). Idempoten: kirim ulang payload sama tak
   * menggandakan (ON CONFLICT by natural key).
   */
  async ingest(unitId: number, payload: IngestPayload): Promise<IngestResponse> {
    const entries = Object.entries(payload.tables).filter(
      ([, rows]) => Array.isArray(rows) && rows.length > 0,
    ) as Array<[string, Record<string, unknown>[]]>;

    for (const [table, rows] of entries) {
      if (!TABLE_CONFIG[table]) {
        throw new UnprocessableEntityException(`tabel tak dikenal: ${table}`);
      }
      if (rows.length > MAX_ROWS_PER_TABLE) {
        throw new UnprocessableEntityException(
          `tabel ${table}: ${rows.length} baris melampaui limit ${MAX_ROWS_PER_TABLE} — pecah batch di agent`,
        );
      }
    }

    // Tabel tagihan HANYA di domain tagihan (dan sebaliknya). Zod sudah menolak;
    // backend menegakkannya lagi: di domain lain baris ini akan menghapus tautan
    // faktur TANPA kunci per-unit `tagihan`. Domain lain tak diperketat di sini —
    // keanggotaan tabel per domain mereka memang belum pernah ditegakkan.
    for (const [table] of entries) {
      if (TAGIHAN_TABLES.includes(table) !== (payload.domain === "tagihan")) {
        throw new UnprocessableEntityException(
          payload.domain === "tagihan"
            ? `tabel ${table} tidak sah untuk domain tagihan`
            : `tabel ${table} hanya sah untuk domain tagihan, bukan ${payload.domain}`,
        );
      }
    }

    const totalRows = entries.reduce((n, [, rows]) => n + rows.length, 0);
    const watermark = payload.watermark_high; // ISO string; cast ::timestamptz di SQL

    // replace_window mirrors [from,to), including source DELETE/renumber.
    // G/L domains prune only missing keys before guarded UPSERT so an identical
    // replacement does not rotate content revision. Tebus keeps its old path.
    // Zod @solamax/shared sudah membatasi domain, tapi backend tetap menegakkan
    // whitelist sendiri (defense-in-depth; identifier tak pernah dari input).
    const win = payload.replace_window;
    if (win && !(REPLACE_WINDOW_DOMAINS as readonly string[]).includes(payload.domain)) {
      throw new UnprocessableEntityException(
        `replace_window tidak sah untuk domain ${payload.domain}`,
      );
    }
    const windowDeletes = !win ? []
      : payload.domain === "delivery" || payload.domain === "terra_resmi"
        ? [{ ...buildGlWindowPrune(payload.domain, unitId, win,
            payload.tables[payload.domain] ?? []), glContributing: true }]
        : buildReplaceWindowDeletes("tebus", unitId, win)
          .map(statement => ({ ...statement, glContributing: false }));

    // replace_details (sales, rescan per tanggal-bisnis): pangkas detail basi per
    // header — baris NURUT yang ditulis ulang EasyMax tak boleh tinggal di mirror.
    if (payload.replace_details && payload.domain !== "sales") {
      throw new UnprocessableEntityException(
        `replace_details tidak sah untuk domain ${payload.domain}`,
      );
    }
    const detailPrune = payload.replace_details
      ? buildSalesDetailPrune(unitId, payload.tables.sales_detail ?? [])
      : null;

    // tagihan_manifest (penutup siklus domain tagihan): SATU-SATUNYA jalur yang
    // menghapus header/pembayaran tagihan. Zod sudah membatasi domain & melarang
    // baris; backend menegakkannya lagi (defense-in-depth, pola replace_window).
    const manifest = payload.tagihan_manifest;
    if (manifest && payload.domain !== "tagihan") {
      throw new UnprocessableEntityException(
        `tagihan_manifest tidak sah untuk domain ${payload.domain}`,
      );
    }
    if (manifest && entries.length > 0) {
      throw new UnprocessableEntityException(
        "payload tagihan_manifest tidak boleh membawa baris",
      );
    }
    if (manifest) {
      for (const [nama, keys] of [
        ["header_keys", manifest.header_keys],
        ["bayar_keys", manifest.bayar_keys],
      ] as const) {
        if (keys.length > MAX_TAGIHAN_MANIFEST_KEYS) {
          throw new UnprocessableEntityException(
            `tagihan_manifest.${nama}: ${keys.length} kunci melampaui limit ${MAX_TAGIHAN_MANIFEST_KEYS}`,
          );
        }
      }
      if (manifest.header_keys.length + manifest.bayar_keys.length > 0 && !manifest.chunk_token) {
        throw new UnprocessableEntityException(
          "tagihan_manifest berisi kunci wajib membawa chunk_token",
        );
      }
    }
    // Tautan faktur diganti PER FAKTUR: untuk tiap faktur di payload, tautan yang
    // tak ada lagi di payload dihapus SEBELUM tautan baru di-INSERT (DO NOTHING).
    // Tanpa header di payload → null → tak ada tautan yang dihapus.
    const tagihanLinkPrune = buildTagihanDetailPrune(
      unitId,
      payload.tables.tagihan_header ?? [],
      payload.tables.tagihan_detail ?? [],
    );
    // Pangkas-saat-lengkap + stempel siklus dijalankan PALING AKHIR sebelum
    // sync_state, lewat applyTagihanManifest (penjaga + pangkas + stempel).
    // Tanpa manifest, header/pembayaran tak pernah dihapus.

    // REPLACE-per-business_date (edc/pelanggan_sale/voucher_sale) → [DELETE, INSERT];
    // selain itu UPSERT by natural key. Semua di SATU transaksi (atomik + idempoten).
    const statements = [
      ...windowDeletes,
      ...(detailPrune ? [{ ...detailPrune, glContributing: true }] : []),
      ...(tagihanLinkPrune ? [{ ...tagihanLinkPrune, glContributing: false }] : []),
      ...entries.flatMap(([table, rows]) => {
        const cfg = TABLE_CONFIG[table]!;
        const tableStatements = cfg.replaceByBusinessDate
          ? buildReplace(cfg, unitId, rows)
          : [buildUpsert(glContentConfig(cfg), unitId, rows)];
        return tableStatements.map(statement => ({ ...statement,
          glContributing: contributesToGl(cfg.table) }));
      }),
    ];

    // Kunci (table,unit,business_date) utk tabel REPLACE TANPA kunci natural
    // (pelanggan_sale/voucher_sale — sumber EasyMax tak expose identitas baris
    // per-line, mis. NURUT; lihat sql.test.ts "REPLACE polos"). Beda dari edc:
    // ON CONFLICT butuh nilai kolom yang benar-benar unik per baris — di sini baris
    // ber-nilai identik (mis. pelanggan yg isi BBM sama persis 2× dlm satu shift)
    // itu SAH, bukan kembar, jadi unique index ala edc akan menelan baris legit
    // (diverifikasi: DISTINCT atas kolom nilai menjatuhkan total ~35% di bawah PDF).
    // pg_advisory_xact_lock tak butuh identitas baris — cukup serialkan dua REPLACE
    // pd (table,unit,business_date) yang sama: transaksi ke-2 menunggu ke-1 commit,
    // lalu DELETE-nya melihat INSERT ke-1 (bukan lagi uncommitted) → tak dobel.
    // Lock ter-lepas otomatis di akhir transaksi (varian _xact_). edc tak perlu ini
    // (sudah dijaga index unik + ON CONFLICT).
    const lockKeys = [
      ...new Set([
        ...entries.flatMap(([table, rows]) => {
          const cfg = TABLE_CONFIG[table]!;
          if (!cfg.replaceByBusinessDate || cfg.conflict.length > 0) return [];
          return rows.map((r) => `${table}:${unitId}:${String(r["business_date"])}`);
        }),
        // replace_window: serialkan DELETE+INSERT per (domain,unit) — dua request
        // tumpang-tindih (retry agent pasca-timeout, kelas insiden edc 2026-06-22)
        // dieksekusi berurutan; yang kedua melihat commit pertama → konvergen, 0 ghost.
        ...(win ? [`replace_window:${payload.domain}:${unitId}`] : []),
        // tagihan: SETIAP payload domain ini (potongan maupun manifest) memegang
        // kunci per-unit yang sama. Pangkas-manifest menghapus "semua yang tak
        // terdaftar"; tanpa serialisasi, potongan yang sedang commit bersamaan
        // (retry agent pasca-timeout) bisa menyisipkan baris yang tak dilihat
        // DELETE-nya, atau sebaliknya kehilangan baris yang baru ditulisnya.
        ...(payload.domain === "tagihan" || manifest ? [`tagihan:${unitId}`] : []),
      ]),
    ].sort(); // urutan tetap → dua transaksi mengunci kunci yang sama dgn urutan sama (anti-deadlock)

    let tagihanToken: string | undefined;
    await this.prisma.$transaction(
      async (prismaTx) => {
        const tx = prismaTx as unknown as IngestTx;
        // RLS (migration 0016): set konteks unit TRANSACTION-LOCAL agar WITH CHECK
        // pada INSERT/UPDATE ke tabel data lolos. unitId sudah tervalidasi lawan
        // API key (ingest.controller). is_local=true → lepas di akhir transaksi.
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.unit_ids', $1, true)`,
          String(unitId),
        );
        for (const key of lockKeys) {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
            key,
          );
        }
        let glChanged = false;
        for (const { sql, params, glContributing } of statements) {
          const affected = await tx.$executeRawUnsafe(sql, ...params);
          if (glContributing && affected > 0) glChanged = true;
        }
        if (manifest) await this.applyTagihanManifest(tx, unitId, manifest);
        // sync_state ikut transaksi yang sama → ter-commit bersama data, tak pernah
        // mendahuluinya. last_watermark hanya digeser maju (GREATEST).
        await tx.$executeRawUnsafe(
          UPDATE_SYNC_STATE_WITH_GL_REVISION_SQL,
          unitId,
          payload.domain,
          watermark,
          totalRows,
          glChanged,
        );
        // Token = identitas penulisan sync_state BARUSAN (transaksi ini). Agent
        // mengembalikan token potongan terakhirnya di manifest; payload tagihan
        // mana pun yang ter-commit sesudahnya mengubah token → manifest basi
        // ditolak (applyTagihanManifest).
        if (payload.domain === "tagihan") {
          const rows = await tx.$queryRawUnsafe<Array<{ token: string | null }>>(
            TAGIHAN_TOKEN_SQL, unitId,
          );
          tagihanToken = rows[0]?.token ?? undefined;
        }
      },
      // Default Prisma interactive-transaction timeout (5000ms) diamati kena di
      // produksi (2026-07-01, GATE 7): burst UPSERT besar (piutang/hutang
      // full-sync, 1000 baris/batch) di bawah kontensi pool kecil
      // (connection_limit=3) dorong wall-clock transaksi ke 5006-6247ms →
      // Prisma auto-expire transaksi SEBELUM commit → 500 ke agent. Semua
      // kejadian pulih via retry bawaan agent (kerja SQL-nya sendiri cepat;
      // murni kontensi durasi-tunggu, bukan bug data) — tapi retry yang bisa
      // dihindari = beban ekstra tak perlu. 15s (< pool_timeout=20 agar
      // transaksi tak pernah nunggu lebih lama dari budget pool) menghapus
      // false-positive ini tanpa menutupi kegagalan asli (deadlock/hang tetap
      // timeout, hanya lebih lambat terdeteksi).
      { timeout: 15_000 },
    );

    // Source-cut capture is intentionally fail-open for /ingest. The mirror transaction above
    // has already committed; source-cut capture/diff gets a separate atomic
    // transaction so any capture, diff, dirty, or enqueue failure cannot roll
    // back mirror rows or turn a successful ingest into HTTP 500.
    if (payload.source_cut && this.snapshotCapture) {
      const startedAt = performance.now();
      try {
        const capture = await this.snapshotCapture.capture(unitId, payload);
        this.logger.log({
          event: "saldo_source_capture",
          unitId,
          domain: payload.source_cut.domain,
          cycleId: payload.source_cut.cycle_id,
          outcome: capture?.outcome,
          addedLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
        });
      } catch (error) {
        this.logger.error({
          event: "saldo_source_capture_failed_ingest_survived",
          unitId,
          domain: payload.source_cut.domain,
          cycleId: payload.source_cut.cycle_id,
          addedLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const upserted: Record<string, number> = {};
    for (const [table, rows] of entries) upserted[table] = rows.length;
    return {
      upserted,
      new_watermark: payload.watermark_high,
      ...(tagihanToken ? { tagihan_token: tagihanToken } : {}),
    };
  }

  /**
   * Penutup siklus domain `tagihan`: penjaga → pangkas → uji jumlah → stempel.
   * Dipanggil DI DALAM transaksi /ingest, sesudah kunci per-unit `tagihan`
   * dipegang. Setiap penolakan melempar 409 → seluruh transaksi batal: tak ada
   * baris terhapus, stempel siklus dan sync_state tak bergerak.
   */
  private async applyTagihanManifest(
    tx: IngestTx,
    unitId: number,
    manifest: TagihanManifest,
  ): Promise<void> {
    const [state] = await tx.$queryRawUnsafe<Array<{
      ada_header: boolean; stamped: string | null; token: string | null;
    }>>(TAGIHAN_MANIFEST_STATE_SQL, unitId);

    // Kirim ulang manifest yang SUDAH distempel (balasan pertama hilang di
    // jaringan): jangan dikerjakan lagi. Mengulang pangkasnya bisa menghapus
    // baris potongan siklus yang lebih baru; menolaknya menyalakan alarm palsu.
    if (state?.stamped && state.stamped === manifest.cycle_id.toLowerCase()) return;

    // 1) Daftar header kosong pada mirror yang masih berisi faktur. Tiga SELECT
    //    agent yang "berhasil dengan nol baris" juga wujud basis data sumber yang
    //    kosong / baru separuh dipulihkan — itu tak boleh menghapus mirror unit.
    if (manifest.header_keys.length === 0 && !manifest.izinkan_kosong && state?.ada_header) {
      throw new ConflictException(
        "tagihan_manifest ditolak: daftar header KOSONG sementara mirror unit ini masih berisi faktur — " +
        "sumber terbaca kosong (basis data kosong / belum pulih?). Tak ada yang dihapus, siklus tidak distempel. " +
        "Bila sumber memang kosong, operator mengirim ulang dengan izinkan_kosong.",
      );
    }

    // 2) Manifest basi. Token = payload tagihan TERAKHIR yang ter-commit untuk
    //    unit ini. Bila bukan potongan terakhir siklus manifest ini, ada payload
    //    lain (siklus lebih baru / proses agent kedua) yang mendarat sesudahnya,
    //    dan pangkas manifest ini akan menghapus baris yang baru ditulisnya.
    //    Manifest kosong tak didahului potongan → tak bertoken; ia dijaga (1).
    if (manifest.header_keys.length + manifest.bayar_keys.length > 0
      && manifest.chunk_token !== state?.token) {
      throw new ConflictException(
        "tagihan_manifest ditolak: basi — ada payload tagihan lain untuk unit ini yang diterima sesudah " +
        "potongan terakhir siklus manifest ini (siklus lebih baru atau dua proses agent). " +
        "Tak ada yang dihapus, siklus tidak distempel.",
      );
    }

    const [hapusBayar, hapusHeader, hapusTautan, stempel] =
      buildTagihanManifestPrune(unitId, manifest);
    for (const st of [hapusBayar!, hapusHeader!, hapusTautan!]) {
      await tx.$executeRawUnsafe(st.sql, ...st.params);
    }

    // 3) Sesudah pangkas, mirror ⊆ manifest. Jumlahnya harus SAMA: selisih =
    //    kunci manifest yang barisnya tak pernah tiba (potongan hilang, atau
    //    sudah dipangkas manifest lain) → siklus ini tak lengkap. Tanpa state
    //    tersimpan; pangkas di atas ikut batal bersama transaksinya.
    const [jumlah] = await tx.$queryRawUnsafe<Array<{ header: number; bayar: number }>>(
      TAGIHAN_MANIFEST_COUNT_SQL, unitId,
    );
    const harap = {
      header: kunciUnik(manifest.header_keys),
      bayar: kunciUnik(manifest.bayar_keys),
    };
    if (Number(jumlah?.header) !== harap.header || Number(jumlah?.bayar) !== harap.bayar) {
      throw new ConflictException(
        `tagihan_manifest ditolak: mirror sesudah pangkas berisi ${Number(jumlah?.header)} header / ` +
        `${Number(jumlah?.bayar)} pembayaran, manifest mendaftar ${harap.header} / ${harap.bayar} — ` +
        "ada kunci yang barisnya tak pernah tiba. Tak ada yang dihapus, siklus tidak distempel.",
      );
    }

    await tx.$executeRawUnsafe(stempel!.sql, ...stempel!.params);
  }
}
