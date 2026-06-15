import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { IngestPayload, IngestResponse } from "@solamax/shared";
import { PrismaService } from "../prisma.service.js";
import { buildUpsert } from "./sql.js";
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

    const statements = entries.map(([table, rows]) =>
      buildUpsert(TABLE_CONFIG[table]!, unitId, rows),
    );

    await this.prisma.$transaction(async (tx) => {
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
    });

    const upserted: Record<string, number> = {};
    for (const [table, rows] of entries) upserted[table] = rows.length;
    return { upserted, new_watermark: payload.watermark_high };
  }
}
