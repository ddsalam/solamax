import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { ACTIVE_UNITS_SQL } from "./sync-health.sql.js";
import {
  RLS_POSITIVE_CONTROL_SQL,
  SET_ALL_UNITS_SCOPE_SQL,
  UNACKNOWLEDGED_FROZEN_SHIFTS_SQL,
} from "./frozen-shift.sql.js";

export type FrozenShift = {
  unitId: number;
  unitName: string;
  asOfDate: string;
  generationId: string;
  previousGenerationId: string;
  sourceCycleSequence: string;
  detectedAt: string;
  geserPiutangLokal: string;
  geserPiutangOnline: string;
  geserHutangLokal: string;
};

export type FrozenShiftReport = {
  /**
   * `scope_returned_nothing` sengaja BUKAN varian sehat, dan di sini taruhannya
   * lebih tinggi daripada di `SyncHealthService`: keadaan sehat pengawas ini
   * BERBENTUK nol baris, jadi kegagalan scope menyamar sebagai kabar baik dengan
   * sempurna. Nama statusnya yang memisahkan keduanya.
   */
  status: "ok" | "unacknowledged_frozen_shift" | "scope_returned_nothing";
  checkedAt: string;
  activeUnits: number;
  shiftRowsVisible: number;
  unacknowledgedCount: number;
  shifts: FrozenShift[];
};

type UnitRow = { unit_id: number; code: string; name: string };
type ControlRow = { pointer_rows: bigint | number; shift_rows: bigint | number };
type ShiftRow = {
  unit_id: number;
  as_of_date: Date;
  generation_id: string;
  previous_generation_id: string;
  source_cycle_sequence: bigint | number;
  detected_at: Date;
  geser_piutang_lokal: unknown;
  geser_piutang_online: unknown;
  geser_hutang_lokal: unknown;
};

/** Tanggal tanpa pergeseran zona: kolomnya DATE, bukan timestamp. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class FrozenShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(): Promise<FrozenShiftReport> {
    // Satu transaksi: scope transaction-local. Terpisah = kueri tanpa scope =
    // nol baris tanpa error = "tidak ada pergeseran".
    const { units, control, rows } = await this.prisma.$transaction(async (tx) => {
      const units = await tx.$queryRawUnsafe<UnitRow[]>(ACTIVE_UNITS_SQL);
      const scope = units.map((u) => u.unit_id).join(",");
      await tx.$queryRawUnsafe(SET_ALL_UNITS_SCOPE_SQL, scope);
      const control = await tx.$queryRawUnsafe<ControlRow[]>(RLS_POSITIVE_CONTROL_SQL);
      const rows = await tx.$queryRawUnsafe<ShiftRow[]>(UNACKNOWLEDGED_FROZEN_SHIFTS_SQL);
      return { units, control, rows };
    });

    const nameOf = new Map(units.map((u) => [u.unit_id, u.name]));
    const pointerRows = Number(control[0]?.pointer_rows ?? 0);
    const shiftRows = Number(control[0]?.shift_rows ?? 0);

    const shifts: FrozenShift[] = rows.map((r) => ({
      unitId: r.unit_id,
      unitName: nameOf.get(r.unit_id) ?? `unit ${r.unit_id}`,
      asOfDate: isoDate(r.as_of_date),
      generationId: r.generation_id,
      previousGenerationId: r.previous_generation_id,
      sourceCycleSequence: String(r.source_cycle_sequence),
      detectedAt: r.detected_at.toISOString(),
      geserPiutangLokal: String(r.geser_piutang_lokal),
      geserPiutangOnline: String(r.geser_piutang_online),
      geserHutangLokal: String(r.geser_hutang_lokal),
    }));

    // 🔑 Urutan penilaian ini tidak boleh dibalik. Kontrol positif diperiksa
    // LEBIH DULU: tanpa itu, scope yang gagal akan lolos sebagai `ok` karena
    // daftar pergeserannya memang kosong.
    const status: FrozenShiftReport["status"] =
      units.length > 0 && pointerRows === 0
        ? "scope_returned_nothing"
        : shifts.length > 0
          ? "unacknowledged_frozen_shift"
          : "ok";

    return {
      status,
      checkedAt: new Date().toISOString(),
      activeUnits: units.length,
      shiftRowsVisible: shiftRows,
      unacknowledgedCount: shifts.length,
      shifts,
    };
  }
}
