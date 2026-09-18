import { describe, expect, it, vi } from "vitest";
import { formatStructuredLine, StructuredLogger } from "./structured-logger.js";
import {
  FROZEN_SHIFT_INCIDENT_MARKER,
  SYNC_HEALTH_INCIDENT_MARKER,
  SYNC_HEALTH_OK_MARKER,
} from "./sync-health.controller.js";

function parse(line: string): Record<string, any> {
  return JSON.parse(line.trimEnd());
}

describe("StructuredLogger", () => {
  it("SATU baris, diakhiri tepat satu newline — dua baris memecah parsernya", () => {
    const line = formatStructuredLine("ERROR", "Probe", { msg: "x", a: 1 });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
  });

  it("severity ikut DI DALAM baris — itu yang membuatnya fakta, bukan tebakan stream", () => {
    expect(parse(formatStructuredLine("ERROR", "Probe", { msg: "x" })).severity).toBe("ERROR");
    expect(parse(formatStructuredLine("INFO", "Probe", { msg: "x" })).severity).toBe("INFO");
  });

  // 🛑 KONTRAK DENGAN LOG-BASED METRIC.
  it("penanda tetap hidup di kunci msg untuk KETIGA penanda", () => {
    for (const marker of [
      SYNC_HEALTH_INCIDENT_MARKER,
      SYNC_HEALTH_OK_MARKER,
      FROZEN_SHIFT_INCIDENT_MARKER,
    ]) {
      const row = parse(formatStructuredLine("ERROR", "Probe", { msg: marker }));
      expect(row.msg).toBe(marker);
      // `message` ikut supaya baris terbaca di Logs Explorer tanpa membuka
      // jsonPayload; ia BUKAN kunci yang dipakai filter.
      expect(row.message).toBe(marker);
    }
  });

  it("muatan bersarang ikut utuh — nama unit dan rupiahnya sampai ke email alarm", () => {
    const row = parse(formatStructuredLine("ERROR", "Probe", {
      msg: FROZEN_SHIFT_INCIDENT_MARKER,
      shifts: [{ unit_id: 1, name: "Imam Bonjol", geser_piutang_lokal: "-895667391" }],
    }));
    expect(row.shifts[0].geser_piutang_lokal).toBe("-895667391");
    expect(row.shifts[0].name).toBe("Imam Bonjol");
  });

  // 🔴 Muatan rusak tidak boleh MEMBUNGKAM alarmnya.
  it("muatan yang tak bisa diserialisasi tetap menerbitkan penanda dan MENYEBUT kehilangannya", () => {
    const melingkar: Record<string, unknown> = { msg: FROZEN_SHIFT_INCIDENT_MARKER };
    melingkar.diri = melingkar;
    const row = parse(formatStructuredLine("ERROR", "Probe", melingkar as never));
    expect(row.msg).toBe(FROZEN_SHIFT_INCIDENT_MARKER);
    expect(row.severity).toBe("ERROR");
    expect(row.detail_unserializable).toBe(true);
  });

  it("ERROR ke stderr, INFO ke stdout — severity tetap eksplisit di keduanya", () => {
    const info = vi.fn();
    const error = vi.fn();
    const logger = new StructuredLogger("Probe", info, error);

    logger.log({ msg: SYNC_HEALTH_OK_MARKER });
    expect(error).not.toHaveBeenCalled();
    expect(parse(info.mock.calls[0]![0] as string)).toMatchObject({
      severity: "INFO", msg: SYNC_HEALTH_OK_MARKER,
    });

    logger.error({ msg: SYNC_HEALTH_INCIDENT_MARKER, reason: "stale_units" });
    expect(parse(error.mock.calls[0]![0] as string)).toMatchObject({
      severity: "ERROR", msg: SYNC_HEALTH_INCIDENT_MARKER, reason: "stale_units",
    });
  });

  it("konteksnya ikut supaya dua probe pada satu revisi bisa dibedakan", () => {
    expect(parse(formatStructuredLine("ERROR", "SyncHealthController", { msg: "x" })).context)
      .toBe("SyncHealthController");
  });
});
