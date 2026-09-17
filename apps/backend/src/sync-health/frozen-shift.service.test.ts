import { describe, expect, it, vi } from "vitest";
import { FrozenShiftService } from "./frozen-shift.service.js";
import type { PrismaService } from "../prisma.service.js";
import {
  RLS_POSITIVE_CONTROL_SQL,
  SET_ALL_UNITS_SCOPE_SQL,
  UNACKNOWLEDGED_FROZEN_SHIFTS_SQL,
} from "./frozen-shift.sql.js";
import { ACTIVE_UNITS_SQL } from "./sync-health.sql.js";

type Call = { sql: string; args: unknown[] };

function harness(opts: {
  units?: Array<{ unit_id: number; code: string; name: string }>;
  pointerRows?: number;
  shiftRows?: number;
  shifts?: Array<Record<string, unknown>>;
}) {
  const calls: Call[] = [];
  const units = opts.units ?? [{ unit_id: 1, code: "6478111", name: "Imam Bonjol" }];
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      calls.push({ sql, args });
      if (sql === ACTIVE_UNITS_SQL) return units;
      if (sql === SET_ALL_UNITS_SCOPE_SQL) return [{}];
      if (sql === RLS_POSITIVE_CONTROL_SQL) {
        return [{ pointer_rows: opts.pointerRows ?? 12, shift_rows: opts.shiftRows ?? 5 }];
      }
      if (sql === UNACKNOWLEDGED_FROZEN_SHIFTS_SQL) return opts.shifts ?? [];
      throw new Error(`kueri tak dikenal: ${sql.slice(0, 40)}`);
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new FrozenShiftService(prisma), calls, prisma };
}

const shiftRow = {
  unit_id: 1,
  as_of_date: new Date("2026-08-31T00:00:00.000Z"),
  generation_id: "g-baru",
  previous_generation_id: "g-lama",
  source_cycle_sequence: 126n,
  detected_at: new Date("2026-09-14T19:05:00.000Z"),
  geser_piutang_lokal: "-690068731",
  geser_piutang_online: "0",
  geser_hutang_lokal: "0",
};

describe("FrozenShiftService", () => {
  it("memasang scope SEBELUM membaca, di dalam SATU transaksi", async () => {
    const { service, calls, prisma } = harness({});
    await service.evaluate();

    // set_config(..., true) transaction-local: terpisah = kueri tanpa scope =
    // nol baris tanpa error = "tidak ada pergeseran".
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const order = calls.map((c) => c.sql);
    expect(order.indexOf(SET_ALL_UNITS_SCOPE_SQL)).toBeLessThan(
      order.indexOf(UNACKNOWLEDGED_FROZEN_SHIFTS_SQL),
    );
    expect(order.indexOf(SET_ALL_UNITS_SCOPE_SQL)).toBeLessThan(
      order.indexOf(RLS_POSITIVE_CONTROL_SQL),
    );
    // Scope-nya SELURUH unit aktif, bukan satu unit.
    expect(calls.find((c) => c.sql === SET_ALL_UNITS_SCOPE_SQL)?.args).toEqual(["1"]);
  });

  it("nol pergeseran = ok", async () => {
    const { service } = harness({});
    await expect(service.evaluate()).resolves.toMatchObject({
      status: "ok",
      unacknowledgedCount: 0,
    });
  });

  it("pergeseran beku yang belum diakui dilaporkan dengan nama unitnya", async () => {
    const { service } = harness({ shifts: [shiftRow] });
    const report = await service.evaluate();
    expect(report.status).toBe("unacknowledged_frozen_shift");
    expect(report.shifts[0]).toMatchObject({
      unitName: "Imam Bonjol",
      asOfDate: "2026-08-31",
      sourceCycleSequence: "126",
      geserPiutangLokal: "-690068731",
    });
  });

  it("🔴 nol pointer pada armada ber-unit-aktif = scope_returned_nothing, BUKAN ok", async () => {
    const { service } = harness({ pointerRows: 0, shiftRows: 0 });
    // Bentuk hasilnya identik dengan keadaan sehat: daftar pergeseran kosong.
    await expect(service.evaluate()).resolves.toMatchObject({
      status: "scope_returned_nothing",
    });
  });

  it("🔴 kontrol positif dinilai LEBIH DULU — scope gagal tak boleh lolos jadi ok", async () => {
    // Kalau urutan penilaiannya dibalik, kasus ini akan berbunyi
    // "unacknowledged_frozen_shift" dan menyembunyikan sebab sebenarnya.
    const { service } = harness({ pointerRows: 0, shiftRows: 0, shifts: [shiftRow] });
    await expect(service.evaluate()).resolves.toMatchObject({
      status: "scope_returned_nothing",
    });
  });

  it("tanpa unit aktif tidak berbunyi — armada kosong bukan kegagalan scope", async () => {
    const { service } = harness({ units: [], pointerRows: 0, shiftRows: 0 });
    await expect(service.evaluate()).resolves.toMatchObject({ status: "ok" });
  });
});
