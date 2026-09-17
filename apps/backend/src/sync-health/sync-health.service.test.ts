import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  DEFAULT_STALE_THRESHOLD_MINUTES,
  SyncHealthService,
} from "./sync-health.service.js";
import { SET_ALL_UNITS_SCOPE_SQL, SYNC_AGE_BY_UNIT_SQL } from "./sync-health.sql.js";

type UnitRow = { unit_id: number; code: string; name: string };
type AgeRow = {
  unit_id: number;
  last_run_at: Date | null;
  domains_total: number;
  age_seconds: number | null;
};

const UNITS: UnitRow[] = [
  { unit_id: 1, code: "6478111", name: "Imam Bonjol" },
  { unit_id: 2, code: "6378301", name: "Bakau" },
];

/**
 * Prisma palsu yang MEREKAM URUTAN panggilan. Urutannya penting: kalau scope
 * RLS tidak berjalan di transaksi yang sama & sebelum kueri umur, kueri itu
 * memulangkan nol baris tanpa error di produksi.
 */
function harness(opts: { units?: UnitRow[]; ages?: AgeRow[] } = {}) {
  const units = opts.units ?? UNITS;
  const ages = opts.ages ?? [];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("FROM public.unit")) return units;
      if (sql.includes("FROM public.sync_state")) return ages;
      return [];
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new SyncHealthService(prisma), calls, prisma };
}

function age(unit_id: number, hoursAgo: number, domains = 14): AgeRow {
  return {
    unit_id,
    last_run_at: new Date(Date.now() - hoursAgo * 3600_000),
    domains_total: domains,
    age_seconds: Math.round(hoursAgo * 3600),
  };
}

afterEach(() => {
  delete process.env.SYNC_STALE_THRESHOLD_MINUTES;
});

describe("SyncHealthService — scope RLS", () => {
  // 🛑 Penjaga terpenting di berkas ini. `sync_state` ber-FORCE ROW LEVEL
  // SECURITY dan `ingest` tanpa BYPASSRLS ⇒ tanpa scope, kueri umur memulangkan
  // NOL BARIS TANPA ERROR, dan alarmnya menjadi alarm yang mustahil berbunyi.
  it("men-scope app.unit_ids ke SEMUA unit aktif, SEBELUM kueri umur, di transaksi yang sama", async () => {
    const { service, calls, prisma } = harness({ ages: [age(1, 0.1), age(2, 0.1)] });
    await service.evaluate();

    const scopeIdx = calls.findIndex((c) => c.sql === SET_ALL_UNITS_SCOPE_SQL);
    const ageIdx = calls.findIndex((c) => c.sql === SYNC_AGE_BY_UNIT_SQL);
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(ageIdx).toBeGreaterThan(scopeIdx); // urutan, bukan sekadar keberadaan
    expect(calls[scopeIdx]!.params[0]).toBe("1,2"); // SEMUA unit, bukan satu
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // satu transaksi
  });

  // Kontrol positif yang hidup di produksi: nol baris ≠ semua sehat.
  it("nol baris sync_state padahal ada unit aktif = INSIDEN, bukan 'ok'", async () => {
    const { service } = harness({ ages: [] });
    const report = await service.evaluate();
    expect(report.status).toBe("scope_returned_nothing");
    expect(report.status).not.toBe("ok");
  });

  it("nol unit aktif bukan insiden — tak ada yang diharapkan mengirim", async () => {
    const { service } = harness({ units: [], ages: [] });
    expect((await service.evaluate()).status).toBe("ok");
  });
});

describe("SyncHealthService — vonis per unit", () => {
  it("memakai domain TERBARU (MAX), sehingga cadence master ±1 jam tidak memicu alarm", async () => {
    // Bentuk armada sehat: domain terbaru hitungan menit walau `masters`/
    // `piutang`/`hutang` baru berjalan sejam lalu. MIN akan salah menuduh.
    const { service } = harness({ ages: [age(1, 0.03), age(2, 0.02)] });
    const report = await service.evaluate();
    expect(report.status).toBe("ok");
    expect(report.units.every((u) => u.verdict === "ok")).toBe(true);
  });

  it("menandai unit yang melewati ambang, dan menyebut namanya", async () => {
    // Bentuk insiden nyata: IB 23,2 jam, Bakau sehat.
    const { service } = harness({ ages: [age(1, 23.2), age(2, 0.02)] });
    const report = await service.evaluate();

    expect(report.status).toBe("stale_units");
    expect(report.staleCount).toBe(1);
    const ib = report.units.find((u) => u.unitId === 1)!;
    expect(ib.verdict).toBe("stale");
    expect(ib.name).toBe("Imam Bonjol");
    expect(report.units.find((u) => u.unitId === 2)!.verdict).toBe("ok");
  });

  it("unit aktif tanpa baris sync_state sama sekali = never_synced, dibedakan dari stale", async () => {
    const { service } = harness({ ages: [age(2, 0.02)] });
    const report = await service.evaluate();
    expect(report.status).toBe("stale_units");
    expect(report.neverSyncedCount).toBe(1);
    expect(report.staleCount).toBe(0); // sebabnya beda, jangan dicampur
    expect(report.units.find((u) => u.unitId === 1)!.verdict).toBe("never_synced");
  });

  it("tepat DI ambang belum stale; sedetik lewat baru stale", async () => {
    const t = DEFAULT_STALE_THRESHOLD_MINUTES * 60;
    const at: AgeRow = { unit_id: 1, last_run_at: new Date(), domains_total: 14, age_seconds: t };
    const over: AgeRow = { ...at, age_seconds: t + 1 };

    const a = harness({ units: [UNITS[0]!], ages: [at] });
    expect((await a.service.evaluate()).units[0]!.verdict).toBe("ok");
    const b = harness({ units: [UNITS[0]!], ages: [over] });
    expect((await b.service.evaluate()).units[0]!.verdict).toBe("stale");
  });
});

describe("SyncHealthService — ambang", () => {
  it("default 120 menit", () => {
    expect(harness().service.thresholdMinutes).toBe(120);
    expect(DEFAULT_STALE_THRESHOLD_MINUTES).toBe(120);
  });

  it("dapat ditimpa env tanpa deploy", () => {
    process.env.SYNC_STALE_THRESHOLD_MINUTES = "30";
    expect(harness().service.thresholdMinutes).toBe(30);
  });

  it("env sampah/nol/negatif jatuh ke default, bukan ke 0 (0 akan mengalarmkan semuanya)", () => {
    for (const bad of ["", "abc", "0", "-5"]) {
      process.env.SYNC_STALE_THRESHOLD_MINUTES = bad;
      expect(harness().service.thresholdMinutes).toBe(120);
    }
  });
});
