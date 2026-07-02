import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { IngestPayload, IngestResponse } from "@solamax/shared";
import { PrismaService } from "../prisma.service.js";
import { buildReplace, buildUpsert } from "./sql.js";
import { MAX_ROWS_PER_TABLE, TABLE_CONFIG } from "./table-config.js";

@Injectable()
export class IngestService {
  constructor(private readonly prisma: PrismaService) {}

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

    const totalRows = entries.reduce((n, [, rows]) => n + rows.length, 0);
    const watermark = payload.watermark_high; // ISO string; cast ::timestamptz di SQL

    // REPLACE-per-business_date (edc/pelanggan_sale/voucher_sale) → [DELETE, INSERT];
    // selain itu UPSERT by natural key. Semua di SATU transaksi (atomik + idempoten).
    const statements = entries.flatMap(([table, rows]) => {
      const cfg = TABLE_CONFIG[table]!;
      return cfg.replaceByBusinessDate
        ? buildReplace(cfg, unitId, rows)
        : [buildUpsert(cfg, unitId, rows)];
    });

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
      ...new Set(
        entries.flatMap(([table, rows]) => {
          const cfg = TABLE_CONFIG[table]!;
          if (!cfg.replaceByBusinessDate || cfg.conflict.length > 0) return [];
          return rows.map((r) => `${table}:${unitId}:${String(r["business_date"])}`);
        }),
      ),
    ].sort(); // urutan tetap → dua transaksi mengunci kunci yang sama dgn urutan sama (anti-deadlock)

    await this.prisma.$transaction(
      async (tx) => {
        for (const key of lockKeys) {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
            key,
          );
        }
        for (const { sql, params } of statements) {
          await tx.$executeRawUnsafe(sql, ...params);
        }
        // sync_state ikut transaksi yang sama → ter-commit bersama data, tak pernah
        // mendahuluinya. last_watermark hanya digeser maju (GREATEST).
        await tx.$executeRawUnsafe(
          `INSERT INTO "sync_state" ("unit_id","domain","last_watermark","last_run_at","last_row_count")
           VALUES ($1,$2,$3::timestamptz,now(),$4)
           ON CONFLICT ("unit_id","domain") DO UPDATE SET
             "last_watermark" = GREATEST(COALESCE(EXCLUDED."last_watermark", "sync_state"."last_watermark"), COALESCE("sync_state"."last_watermark", EXCLUDED."last_watermark")),
             "last_run_at" = now(),
             "last_row_count" = EXCLUDED."last_row_count"`,
          unitId,
          payload.domain,
          watermark,
          totalRows,
        );
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

    const upserted: Record<string, number> = {};
    for (const [table, rows] of entries) upserted[table] = rows.length;
    return { upserted, new_watermark: payload.watermark_high };
  }
}
