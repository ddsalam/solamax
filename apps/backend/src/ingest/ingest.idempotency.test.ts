import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { IngestPayload } from "@solamax/shared";
import { IngestService } from "./ingest.service.js";
import type { PrismaService } from "../prisma.service.js";

/**
 * Idempotensi + completeness /ingest pada DB nyata (F1b). UPSERT (deposit) &
 * REPLACE-per-business_date (edc/pelanggan_sale). Membuktikan: resend → 0 dup /
 * 0 drop; koreksi (kurang baris) bersih tanpa stale; lintas-tanggal tak saling hapus.
 *
 * Jalan hanya bila INGEST_LIVE_DB=1 & DATABASE_URL (role penulis, mis. superuser
 * lokal). Selain itu skip (pnpm check tetap hijau tanpa DB).
 */
const LIVE = process.env.INGEST_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;
const U = 9999; // unit_id uji (terisolasi)

d("idempotensi /ingest (DB lokal)", () => {
  let prisma: PrismaClient;
  let svc: IngestService;

  const count = async (table: string, where = ""): Promise<number> => {
    const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM public."${table}" WHERE unit_id = ${U} ${where}`,
    );
    return Number(r[0]!.n);
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    svc = new IngestService(prisma as unknown as PrismaService);
    for (const t of ["deposit", "edc", "pelanggan_sale", "voucher_sale", "card"]) {
      await prisma.$executeRawUnsafe(`DELETE FROM public."${t}" WHERE unit_id = ${U}`);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM public.sync_state WHERE unit_id = ${U}`);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const depoPayload = (dp1Total: number): IngestPayload => ({
    unit_code: "x",
    domain: "deposit",
    watermark_high: null,
    tables: {
      deposit: [
        { ckddepo: "DP1", dtgl: "2026-06-17", ckdplg: "PLG1", ntotal: dp1Total, nsaldo: 0, sbatal: 0, vcket: "a" },
        { ckddepo: "DP2", dtgl: "2026-06-17", ckdplg: "PLG2", ntotal: 5, nsaldo: 0, sbatal: 0, vcket: "b" },
      ],
    },
  });

  const edcPayload = (date: string, rows: number): IngestPayload => ({
    unit_code: "x",
    domain: "edc",
    watermark_high: null,
    tables: {
      edc: Array.from({ length: rows }, (_, i) => ({
        business_date: date, cshift: "1", tanggaljam: "2026-06-14T08:00:00.000Z",
        ckdkartu: "QR01", total: 1000 + i, liter: 0, jenis: 5,
        cnotrace: `T${i}`, nonozle: "3", jrnkey: 1,
      })),
    },
  });

  it("deposit UPSERT: resend → 0 dup; nilai ter-update", async () => {
    await svc.ingest(U, depoPayload(100));
    expect(await count("deposit")).toBe(2);
    await svc.ingest(U, depoPayload(100)); // resend identik
    expect(await count("deposit")).toBe(2); // 0 dup
    await svc.ingest(U, depoPayload(999)); // ubah ntotal DP1
    expect(await count("deposit")).toBe(2); // tetap 2
    const r = await prisma.$queryRawUnsafe<Array<{ ntotal: string }>>(
      `SELECT ntotal FROM public.deposit WHERE unit_id = ${U} AND trim(ckddepo) = 'DP1'`,
    );
    expect(Number(r[0]!.ntotal)).toBe(999); // ter-update (UPSERT)
  });

  it("edc REPLACE: resend 0 dup/0 drop; koreksi bersih; lintas-tanggal aman", async () => {
    await svc.ingest(U, edcPayload("2026-06-14", 3));
    expect(await count("edc", "AND business_date = '2026-06-14'")).toBe(3);
    await svc.ingest(U, edcPayload("2026-06-14", 3)); // resend
    expect(await count("edc", "AND business_date = '2026-06-14'")).toBe(3); // 0 dup / 0 drop
    await svc.ingest(U, edcPayload("2026-06-14", 2)); // koreksi: 2 baris
    expect(await count("edc", "AND business_date = '2026-06-14'")).toBe(2); // stale ke-3 dibuang
    await svc.ingest(U, edcPayload("2026-06-15", 1)); // tanggal lain
    expect(await count("edc", "AND business_date = '2026-06-15'")).toBe(1);
    expect(await count("edc", "AND business_date = '2026-06-14'")).toBe(2); // 14 tak terhapus
  });

  it("REPLACE multi-tanggal dalam satu payload: kedua tanggal masuk", async () => {
    const multi: IngestPayload = {
      unit_code: "x", domain: "pelanggan", watermark_high: null,
      tables: {
        pelanggan_sale: [
          { business_date: "2026-06-16", ckdplg: "PLG1", vcnmplg: "A", ckdjualplg: "JP1", ckdbbm: "BB-07", nshift: 1, liter: 10, total: 100, sbatal: 0 },
          { business_date: "2026-06-17", ckdplg: "PLG2", vcnmplg: "B", ckdjualplg: "JP2", ckdbbm: "BB-07", nshift: 1, liter: 20, total: 200, sbatal: 0 },
        ],
      },
    };
    await svc.ingest(U, multi);
    expect(await count("pelanggan_sale", "AND business_date = '2026-06-16'")).toBe(1);
    expect(await count("pelanggan_sale", "AND business_date = '2026-06-17'")).toBe(1);
  });
});
