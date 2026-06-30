import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Batasi pool koneksi Prisma di sumber connection-string (tanpa sentuh secret).
 * Cloud SQL f1-micro berbagi cap max_connections=25 (superuser_reserved=3 → 22
 * usable) dgn dashboard. Anggaran: dashboard 5×2=10 + backend 3×(≤2)=6 + cadangan
 * admin/migrasi ⇒ < 22. Default Prisma (num_cpus×2+1, bisa >host-core di Cloud Run)
 * tak terbatas → bisa kuras cap. `pool_timeout` cegah gantung tak-hingga saat jenuh.
 */
function boundedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined; // biarkan Prisma baca env sendiri (dev/test)
  const add: string[] = [];
  if (!/[?&]connection_limit=/.test(raw)) add.push("connection_limit=3");
  if (!/[?&]pool_timeout=/.test(raw)) add.push("pool_timeout=20");
  if (add.length === 0) return raw;
  return raw + (raw.includes("?") ? "&" : "?") + add.join("&");
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = boundedDatabaseUrl();
    super(url ? { datasourceUrl: url } : {});
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
