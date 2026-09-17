import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FROZEN_SHIFT_INCIDENT_MARKER,
  SYNC_HEALTH_INCIDENT_MARKER,
  SYNC_HEALTH_OK_MARKER,
  SyncHealthController,
} from "./sync-health.controller.js";
import type {
  SyncHealthReport,
  SyncHealthService,
} from "./sync-health.service.js";
import type {
  FrozenShiftReport,
  FrozenShiftService,
} from "./frozen-shift.service.js";

const SECRET = "rahasia-uji-sync-health-cukup-panjang-32-karakter";

function report(over: Partial<SyncHealthReport> = {}): SyncHealthReport {
  return {
    status: "ok",
    checkedAt: "2026-09-17T07:00:00.000Z",
    thresholdMinutes: 120,
    activeUnits: 7,
    staleCount: 0,
    neverSyncedCount: 0,
    units: [],
    ...over,
  };
}

export function frozenReport(over: Partial<FrozenShiftReport> = {}): FrozenShiftReport {
  return {
    status: "ok",
    checkedAt: "2026-09-17T07:00:00.000Z",
    activeUnits: 7,
    shiftRowsVisible: 29,
    unacknowledgedCount: 0,
    shifts: [],
    ...over,
  };
}

function harness(
  r: SyncHealthReport = report(),
  f: FrozenShiftReport | Error = frozenReport(),
) {
  const service = {
    evaluate: vi.fn(async () => r),
  } as unknown as SyncHealthService;
  const frozen = {
    evaluate: vi.fn(async () => {
      if (f instanceof Error) throw f;
      return f;
    }),
  } as unknown as FrozenShiftService;
  const controller = new SyncHealthController(service, frozen);
  const logs: Array<{ level: "log" | "error"; payload: Record<string, unknown> }> = [];
  // @ts-expect-error — logger privat; kita mengintip keluarannya dengan sengaja
  // karena SEVERITY-nya adalah kontrak alarm, bukan detail internal.
  controller.logger = {
    log: (p: Record<string, unknown>) => logs.push({ level: "log", payload: p }),
    error: (p: Record<string, unknown>) => logs.push({ level: "error", payload: p }),
  };
  return { controller, logs, service };
}

afterEach(() => {
  delete process.env.SYNC_HEALTH_SECRET;
});

describe("SyncHealthController — otorisasi", () => {
  it("menolak tanpa rahasia / rahasia salah / panjang beda", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    for (const bad of [undefined, "", "salah", `${SECRET}x`]) {
      const { controller } = harness();
      await expect(controller.check(bad)).rejects.toMatchObject({ status: 401 });
    }
  });

  it("menolak bila rahasianya belum dipasang di server (fail-closed)", async () => {
    const { controller } = harness();
    await expect(controller.check(SECRET)).rejects.toMatchObject({ status: 401 });
  });

  it("menolak rahasia terlalu pendek walau cocok — ambang 32 karakter", async () => {
    process.env.SYNC_HEALTH_SECRET = "pendek";
    const { controller } = harness();
    await expect(controller.check("pendek")).rejects.toMatchObject({ status: 401 });
  });

  // Kewenangan terpisah: probe baca-saja tak boleh memakai kunci pemicu build.
  it("TIDAK menerima SNAPSHOT_TRIGGER_SECRET", async () => {
    process.env.SNAPSHOT_TRIGGER_SECRET = SECRET;
    const { controller } = harness();
    await expect(controller.check(SECRET)).rejects.toMatchObject({ status: 401 });
    delete process.env.SNAPSHOT_TRIGGER_SECRET;
  });
});

describe("SyncHealthController — severity adalah kontrak alarm", () => {
  it("sehat: satu baris INFO, TANPA penanda insiden (senyap secara default)", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(report());
    await controller.check(SECRET);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe("log");
    expect(logs[0]!.payload.msg).toBe(SYNC_HEALTH_OK_MARKER);
    expect(JSON.stringify(logs)).not.toContain(SYNC_HEALTH_INCIDENT_MARKER);
  });

  it("unit diam: ERROR ber-penanda insiden, menyebut nama & umur jam", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(
      report({
        status: "stale_units",
        staleCount: 1,
        units: [
          {
            unitId: 1, code: "6478111", name: "Imam Bonjol", verdict: "stale",
            lastRunAt: "2026-09-16T07:33:54.000Z", ageSeconds: 83_520, domainsTotal: 14,
          },
          {
            unitId: 2, code: "6378301", name: "Bakau", verdict: "ok",
            lastRunAt: "2026-09-17T06:44:13.000Z", ageSeconds: 100, domainsTotal: 14,
          },
        ],
      }),
    );
    await controller.check(SECRET);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe("error"); // severity = jalur yang dikonsumsi alarm
    expect(logs[0]!.payload.msg).toBe(SYNC_HEALTH_INCIDENT_MARKER);
    const units = logs[0]!.payload.units as Array<Record<string, unknown>>;
    expect(units).toHaveLength(1); // unit sehat tak ikut dicetak
    expect(units[0]!).toMatchObject({ unit_id: 1, name: "Imam Bonjol", verdict: "stale" });
    expect(units[0]!.age_hours).toBe(23.2); // bisa ditindak tanpa membuka psql
  });

  it("scope_returned_nothing juga ERROR — nol baris tak boleh lewat sebagai tenang", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(report({ status: "scope_returned_nothing" }));
    await controller.check(SECRET);
    expect(logs[0]!.level).toBe("error");
    expect(logs[0]!.payload.reason).toBe("scope_returned_nothing");
  });

  // Kalau penanda berubah tanpa metriknya ikut diubah, alarmnya mati DIAM-DIAM.
  // Uji ini membuat perubahan itu menjatuhkan CI, bukan menjatuhkan alarm.
  it("penanda log terkunci — satu kontrak dengan log-based metric", () => {
    expect(SYNC_HEALTH_INCIDENT_MARKER).toBe("sync_health_incident");
    expect(SYNC_HEALTH_OK_MARKER).toBe("sync_health_ok");
  });
});

describe("SyncHealthController — probe yang menemukan masalah BUKAN probe yang gagal", () => {
  it("memulangkan 200 + laporan saat ada unit diam (bukan melempar)", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const r = report({ status: "stale_units", staleCount: 1 });
    const { controller } = harness(r);
    // Tidak melempar ⇒ Nest membalas 200 ⇒ Scheduler tidak menandai job gagal
    // ⇒ tidak ada retry ⇒ "sekali per insiden" tetap sekali.
    await expect(controller.check(SECRET)).resolves.toMatchObject(r);
  });
});

describe("SyncHealthController — pengawas pergerakan angka BEKU", () => {
  it("penanda alarmnya TERKUNCI sebagai kontrak dengan log-based metric", () => {
    expect(FROZEN_SHIFT_INCIDENT_MARKER).toBe("frozen_shift_incident");
    // Rel yang sama, penanda yang BERBEDA — kalau keduanya sama, satu policy
    // tak akan bisa memisahkan "unit berhenti" dari "angka beku bergerak".
    expect(FROZEN_SHIFT_INCIDENT_MARKER).not.toBe(SYNC_HEALTH_INCIDENT_MARKER);
  });

  it("pergeseran beku yang belum diakui terbit sebagai ERROR, bukan INFO", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(
      report(),
      frozenReport({
        status: "unacknowledged_frozen_shift",
        unacknowledgedCount: 1,
        shifts: [
          {
            unitId: 1,
            unitName: "Imam Bonjol",
            asOfDate: "2026-08-31",
            generationId: "g-baru",
            previousGenerationId: "g-lama",
            sourceCycleSequence: "126",
            detectedAt: "2026-09-14T19:00:00.000Z",
            geserPiutangLokal: "-690068731",
            geserPiutangOnline: "0",
            geserHutangLokal: "0",
          },
        ],
      }),
    );

    await controller.check(SECRET);

    const alarm = logs.find((l) => l.payload.msg === FROZEN_SHIFT_INCIDENT_MARKER);
    expect(alarm?.level).toBe("error");
    expect(alarm?.payload.reason).toBe("unacknowledged_frozen_shift");
    // Angkanya ikut ke email supaya bisa ditindak tanpa psql.
    expect(JSON.stringify(alarm?.payload)).toContain("-690068731");
    expect(JSON.stringify(alarm?.payload)).toContain("2026-08-31");
  });

  it("nol pergeseran SENYAP — alarm yang selalu menyala melatih orang mengabaikannya", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(report(), frozenReport());
    await controller.check(SECRET);
    expect(logs.some((l) => l.payload.msg === FROZEN_SHIFT_INCIDENT_MARKER)).toBe(false);
  });

  it("scope RLS gagal BERBUNYI, tidak menyamar jadi 'tak ada pergeseran'", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(
      report(),
      // Bentuk yang persis sama dengan keadaan sehat: nol pergeseran.
      frozenReport({ status: "scope_returned_nothing", shiftRowsVisible: 0 }),
    );
    await controller.check(SECRET);
    const alarm = logs.find((l) => l.payload.msg === FROZEN_SHIFT_INCIDENT_MARKER);
    expect(alarm?.level).toBe("error");
    expect(alarm?.payload.reason).toBe("scope_returned_nothing");
  });

  it("probe yang MELEDAK berbunyi, dan tidak ikut menjatuhkan alarm unit-diam", async () => {
    process.env.SYNC_HEALTH_SECRET = SECRET;
    const { controller, logs } = harness(
      report({ status: "stale_units", staleCount: 1 }),
      new Error("relation app.saldo_pelanggan_shift does not exist"),
    );

    const res = await controller.check(SECRET);

    // Berbunyi di rel yang sama, dengan sebab yang disebut namanya.
    const alarm = logs.find((l) => l.payload.msg === FROZEN_SHIFT_INCIDENT_MARKER);
    expect(alarm?.level).toBe("error");
    expect(alarm?.payload.reason).toBe("probe_failed");
    // Dan alarm unit-diam TETAP terbit — dua pengawas tak saling menjatuhkan.
    expect(logs.some((l) => l.payload.msg === SYNC_HEALTH_INCIDENT_MARKER)).toBe(true);
    expect(res.frozenShift.status).toBe("scope_returned_nothing");
  });
});
