/**
 * Seed dev/staging: unit pilot Imam Bonjol + sample data kecil tiap tabel
 * (untuk dev dashboard tanpa data nyata). API key diambil dari env
 * SEED_API_KEY (wajib di-set; tak ada default agar tak ada key tercetak di git).
 *
 *   SEED_API_KEY=$(node scripts/gen-api-key.mjs | head -1 | awk '{print $NF}') \
 *     pnpm --filter @solamax/backend seed
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const apiKey = process.env.SEED_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SEED_API_KEY wajib di-set (generate: pnpm --filter @solamax/backend gen-api-key)",
    );
  }
  const apiKeyHash = createHash("sha256").update(apiKey, "utf8").digest("hex");

  await prisma.unit.upsert({
    where: { code: "6478111" },
    create: {
      unitId: 1,
      code: "6478111",
      name: "Imam Bonjol",
      apiKeyHash,
      timezone: "Asia/Pontianak",
    },
    update: { apiKeyHash },
  });

  // Sample kecil untuk dev (idempoten; data nyata akan menimpa via /ingest).
  await prisma.salesHeader.upsert({
    where: { unitId_ckdjualbbm: { unitId: 1, ckdjualbbm: "SEED-JB-000001 " } },
    create: {
      unitId: 1,
      ckdjualbbm: "SEED-JB-000001 ",
      dtgljual: new Date("2026-06-01"),
      nshift: 1,
      vcket: "seed dev",
    },
    update: {},
  });
  await prisma.salesDetail.upsert({
    where: {
      unitId_ckdjualbbm_ckdnozzle_nurut: {
        unitId: 1,
        ckdjualbbm: "SEED-JB-000001 ",
        ckdnozzle: "N01  ",
        nurut: 1,
      },
    },
    create: {
      unitId: 1,
      ckdjualbbm: "SEED-JB-000001 ",
      ckdnozzle: "N01  ",
      nurut: 1,
      nstandawal: 1000,
      nstandakhir: 1050,
      nvolume: 50,
      nhargajual: 10000,
      nsubtotal: 500000,
      ckdbbm: "P1   ",
      dtgljam: new Date("2026-06-01T08:00:00Z"),
      subah: 0,
      sedit: 0,
    },
    update: {},
  });

  console.log("seed selesai: unit 6478111 (Imam Bonjol) + sample sales");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
