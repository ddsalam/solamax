import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS + perilaku atas `buku-besar-actions.ts` (rencana 2026-11-02 K6
 * U8/U9; R7–R9, KD13). Dua lapis:
 *   1. teks — urutan wewenang → validasi → koneksi → RLS → baca → periksa →
 *      DML → audit → COMMIT, dan setiap penolakan sesudah BEGIN ber-ROLLBACK;
 *   2. perilaku `setujuiMemorial` terhadap DB tiruan (empat mata, peran).
 *
 * ⚠️ Batas: membuktikan penjagaan ADA dan bekerja pada logika aksi; trigger/CHECK
 * DB (`jurnal_empat_mata`, beku) dibuktikan oleh uji DB, bukan di sini.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const KODE = tanpaKomentar(readFileSync(resolve(__dirname, "buku-besar-actions.ts"), "utf8"));

/** Badan satu `export async function` — sampai `export` berikutnya. */
const badan = (nama: string): string => {
  const i = KODE.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = KODE.indexOf("\nexport ", i + 1);
  return KODE.slice(i, j < 0 ? undefined : j);
};

/** Tukar kemunculan pertama `a` dan `b` — memaksa urutan terbalik. */
const tukar = (teks: string, a: string, b: string): string => teks.replace(a, "\u0000").replace(b, a).replace("\u0000", b);

const AKSI = ["bentukUlangBukuBesar", "simpanSaldoAwalPos", "usulkanMemorial", "setujuiMemorial", "tolakMemorial", "balikMemorial"];

describe("buku-besar-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    for (const f of AKSI) expect(badan(f).length, f).toBeGreaterThan(200);
  });

  it("🔴 SETIAP penolakan sesudah BEGIN didahului ROLLBACK (batal) — tak ada return ok:false tanpa batal", () => {
    for (const f of AKSI.slice(1)) {
      const b = badan(f);
      const sesudah = b.slice(b.indexOf('client.query("BEGIN")'));
      const semua = (sesudah.match(/return \{ ok: false/g) ?? []).length;
      const berbatal = (sesudah.match(/await batal\(client\);\s*return \{ ok: false/g) ?? []).length;
      expect(semua, `${f}: tak ada penolakan sesudah BEGIN — penjaga tanpa subjek`).toBeGreaterThan(0);
      expect(berbatal, `${f}: return ok:false tanpa batal(client)`).toBe(semua);
    }
  });

  it("bentukUlangBukuBesar: scope → wewenang HoF SEBELUM koneksi/tulis; pesan kalah dari bentukUlangRentang", () => {
    const b = badan("bentukUlangBukuBesar");
    expect(urutan(b, "requireUnit(", "canTutupBulan(")).toBe("ok");
    expect(urutan(b, "canTutupBulan(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "canTutupBulan(", "bentukUlangRentang(")).toBe("ok");
    // Aktor ditentukan server, bukan klien.
    expect(b).toMatch(/aktor: \{ userId: scope\.userId, email: scope\.email \}/);
  });

  it("simpanSaldoAwalPos: wewenang & validasi bentuk SEBELUM koneksi; RLS → kunci → baca → periksa → void → sisip → audit → COMMIT", () => {
    const b = badan("simpanSaldoAwalPos");
    expect(urutan(b, "canIsiSaldoAwalPos(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "senDariIsian(", "pool.connect()")).toBe("ok");
    expect(urutan(b, 'client.query("BEGIN")', "set_config('app.unit_ids'")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "pg_advisory_xact_lock(")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "FROM app.tutup_bulan")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "daftarPosDiTransaksi(client")).toBe("ok");
    expect(urutan(b, "pg_advisory_xact_lock(", "FROM app.tutup_bulan")).toBe("ok");
    expect(urutan(b, "FROM app.tutup_bulan", "periksaSaldoAwal(")).toBe("ok");
    expect(urutan(b, "periksaSaldoAwal(", "UPDATE app.saldo_awal_pos")).toBe("ok");
    expect(urutan(b, "UPDATE app.saldo_awal_pos", "INSERT INTO app.saldo_awal_pos")).toBe("ok");
    expect(urutan(b, "INSERT INTO app.saldo_awal_pos", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Void-only: tak ada DELETE.
    expect(b).not.toMatch(/DELETE FROM/);
  });

  it("usulkanMemorial: wewenang & bentuk SEBELUM koneksi; RLS → baca pos → periksaMemorial → bulan beku → sisip → audit → COMMIT", () => {
    const b = badan("usulkanMemorial");
    expect(urutan(b, "canUsulkanMemorial(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "senDariIsian(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "daftarPosDiTransaksi(client")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "periksaMemorial(")).toBe("ok");
    expect(urutan(b, "periksaMemorial(", "bulanBeku(client")).toBe("ok");
    expect(urutan(b, "bulanBeku(client", "sisipMemorial(client")).toBe("ok");
    expect(urutan(b, "periksaMemorial(", "sisipMemorial(client")).toBe("ok");
    expect(urutan(b, "sisipMemorial(client", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Status diputuskan server dari hasil periksa, pengusul dari scope — bukan dari input.
    expect(b).toMatch(/status: hasil\.status/);
    expect(b).toMatch(/pengusul: scope\.userId/);
    expect(b).not.toMatch(/input\.status|input\.pengusul/);
  });

  it("🔴 setujuiMemorial: wewenang Direksi & UUID SEBELUM koneksi; RLS → kunci baris → periksaPersetujuan → UPDATE aktif → audit → COMMIT", () => {
    const b = badan("setujuiMemorial");
    expect(urutan(b, "canSetujuiMemorial(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "UUID_RE.test(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "kunciMemorial(client")).toBe("ok");
    expect(urutan(b, "kunciMemorial(client", "periksaPersetujuan(")).toBe("ok");
    expect(urutan(b, "periksaPersetujuan(", "pg_advisory_xact_lock_shared(")).toBe("ok");
    expect(urutan(b, "periksaPersetujuan(", "UPDATE app.jurnal SET status = 'aktif'")).toBe("ok");
    expect(urutan(b, "pg_advisory_xact_lock_shared(", "UPDATE app.jurnal SET status = 'aktif'")).toBe("ok");
    expect(urutan(b, "UPDATE app.jurnal SET status = 'aktif'", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // UPDATE hanya atas yang masih menunggu, dan penyetuju = aktor sesi.
    expect(b).toMatch(/disetujui_oleh_user_id = \$3[\s\S]*AND status = 'menunggu'/);
    expect(b).toMatch(/\[input\.id, unit\.unit_id, scope\.userId\]/);
    // Predikat dihitung SEKALI dan dioper ke model — satu sumber kebenaran.
    expect(b).toMatch(/periksaPersetujuan\(j, \{ userId: scope\.userId, bolehSetujui \}\)/);
  });

  it("tolakMemorial: wewenang, UUID, alasan SEBELUM koneksi; RLS → kunci → cek pengusul → UPDATE batal → audit → COMMIT", () => {
    const b = badan("tolakMemorial");
    expect(urutan(b, "canSetujuiMemorial(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "UUID_RE.test(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "input.alasan.trim() === \"\"", "pool.connect()")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "kunciMemorial(client")).toBe("ok");
    expect(urutan(b, "kunciMemorial(client", "pengusulSendiri")).toBe("ok");
    expect(urutan(b, "!bolehSetujui && !pengusulSendiri", "UPDATE app.jurnal SET status = 'batal'")).toBe("ok");
    expect(urutan(b, "UPDATE app.jurnal SET status = 'batal'", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
  });

  it("balikMemorial: wewenang HoF, UUID, alasan SEBELUM koneksi; RLS → kunci → sudah dibalik? → periksaMemorial → bulan beku → sisip → audit → COMMIT", () => {
    const b = badan("balikMemorial");
    expect(urutan(b, "canUsulkanMemorial(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "UUID_RE.test(", "pool.connect()")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "kunciMemorial(client")).toBe("ok");
    expect(urutan(b, "kunciMemorial(client", "sudah.rows[0]?.ada")).toBe("ok");
    expect(urutan(b, "sudah.rows[0]?.ada", "periksaMemorial(")).toBe("ok");
    expect(urutan(b, "periksaMemorial(", "bulanBeku(client")).toBe("ok");
    expect(urutan(b, "bulanBeku(client", "sisipMemorial(client")).toBe("ok");
    expect(urutan(b, "sisipMemorial(client", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Jurnal asli tidak diubah: pembalikan = sisip memorial baru, tanpa UPDATE app.jurnal.
    expect(b).not.toMatch(/UPDATE app\.jurnal/);
  });

  it("daya-beda: pemeriksa urutan MEMERAHKAN versi yang dibalik/dihapus (penjaga bukan lulus-selalu)", () => {
    const b = badan("setujuiMemorial");
    expect(urutan(tukar(b, "canSetujuiMemorial(", "pool.connect()"), "canSetujuiMemorial(", "pool.connect()")).not.toBe("ok");
    expect(urutan(tukar(b, "periksaPersetujuan(", "UPDATE app.jurnal SET status = 'aktif'"), "periksaPersetujuan(", "UPDATE app.jurnal SET status = 'aktif'")).not.toBe("ok");
    expect(urutan(tukar(b, "auditKeuangan(client", 'client.query("COMMIT")'), "auditKeuangan(client", 'client.query("COMMIT")')).not.toBe("ok");
    expect(urutan(b.replaceAll("canSetujuiMemorial(", "x("), "canSetujuiMemorial(", "pool.connect()")).not.toBe("ok");
    const bu = badan("usulkanMemorial");
    expect(urutan(tukar(bu, "periksaMemorial(", "sisipMemorial(client"), "periksaMemorial(", "sisipMemorial(client")).not.toBe("ok");
    const gen = b.replace(/await batal\(client\);(\s*return \{ ok: false)/g, "$1");
    expect((gen.match(/await batal\(client\);\s*return \{ ok: false/g) ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Perilaku setujuiMemorial terhadap DB tiruan
// ---------------------------------------------------------------------------
const UUID = "11111111-2222-4333-8444-555555555555";

const t = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  const log: { sql: string; params: unknown[] }[] = [];
  const state = {
    scope: { userId: 9, role: "direksi", email: "direksi@solagroup.co" },
    jurnal: { status: "menunggu", diusulkanOleh: 7 as number | null },
  };
  const ok = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("FROM app.jurnal WHERE id")) {
        return ok([
          { status: state.jurnal.status, diusulkanOleh: state.jurnal.diusulkanOleh, tanggal: "2026-10-15", sumberTabel: null, keterangan: "contoh" },
        ]);
      }
      if (sql.includes("FROM app.jurnal_baris")) {
        return ok([
          { posKode: "1110", debetSen: "20000000", kreditSen: "0" },
          { posKode: "3200", debetSen: "0", kreditSen: "20000000" },
        ]);
      }
      if (sql.startsWith("UPDATE app.jurnal")) return { rows: [], rowCount: 1 };
      return ok();
    },
    release: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { log, state, connect, client };
});

vi.mock("./db", () => ({ pool: { connect: t.connect }, qScoped: vi.fn(), q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    ...t.state.scope,
    requireUnit(code: string) {
      if (code !== "6300001") throw new Error("NEXT_NOT_FOUND");
      return { unit_id: 2, code, name: "Contoh" };
    },
  })),
}));

const { setujuiMemorial } = await import("./buku-besar-actions");

const dml = () => t.log.filter((l) => /^\s*(UPDATE|INSERT|DELETE)/i.test(l.sql));
const updateJurnal = () => t.log.filter((l) => l.sql.startsWith("UPDATE app.jurnal"));

describe("setujuiMemorial — perilaku (DB tiruan)", () => {
  beforeEach(() => {
    t.log.length = 0;
    t.connect.mockClear();
    t.state.scope = { userId: 9, role: "direksi", email: "direksi@solagroup.co" };
    t.state.jurnal = { status: "menunggu", diusulkanOleh: 7 };
  });

  it("(1) pengusul yang menyetujui memorialnya sendiri ditolak — tanpa UPDATE, ROLLBACK, tanpa audit", async () => {
    t.state.scope = { userId: 7, role: "direksi", email: "direksi@solagroup.co" };
    t.state.jurnal = { status: "menunggu", diusulkanOleh: 7 };
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r).toEqual({ ok: false, error: "Pengusul tidak boleh menyetujui jurnal memorialnya sendiri." });
    expect(updateJurnal()).toHaveLength(0);
    expect(dml()).toHaveLength(0);
    expect(t.log.some((l) => l.sql === "ROLLBACK")).toBe(true);
    expect(t.log.some((l) => l.sql === "COMMIT")).toBe(false);
  });

  it("(1b) super admin pengusul pun tak boleh menyetujui usulannya sendiri", async () => {
    t.state.scope = { userId: 7, role: "super_admin", email: "root@solagroup.co" };
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r.ok).toBe(false);
    expect(updateJurnal()).toHaveLength(0);
  });

  it("(2) Head of Finance (peran keuangan) ditolak — tanpa koneksi, tanpa UPDATE", async () => {
    t.state.scope = { userId: 7, role: "keuangan", email: "hof@solagroup.co" };
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r).toEqual({ ok: false, error: "Hanya Direksi yang boleh menyetujui jurnal memorial." });
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.log).toHaveLength(0);
  });

  it("(2b) staf keuangan biasa juga ditolak tanpa UPDATE", async () => {
    t.state.scope = { userId: 3, role: "keuangan", email: "staf@solagroup.co" };
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r.ok).toBe(false);
    expect(updateJurnal()).toHaveLength(0);
  });

  it("(3) Direksi lain menyetujui: UPDATE status 'aktif' atas jurnal & unit yang benar, penyetuju = aktor, lalu audit & COMMIT", async () => {
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r.ok).toBe(true);
    const up = updateJurnal();
    expect(up).toHaveLength(1);
    expect(up[0]!.sql).toMatch(/SET status = 'aktif'/);
    expect(up[0]!.sql).toMatch(/AND status = 'menunggu'/);
    expect(up[0]!.params).toEqual([UUID, 2, 9]);
    const audit = t.log.find((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(audit?.params[2]).toBe("buku_besar.memorial_setujui");
    const urut = t.log.map((l) => l.sql);
    expect(urut.indexOf("COMMIT")).toBeGreaterThan(urut.findIndex((s) => s.startsWith("UPDATE app.jurnal")));
    expect(urut).not.toContain("ROLLBACK");
  });

  it("jurnal yang tak lagi menunggu ditolak tanpa UPDATE", async () => {
    t.state.jurnal = { status: "aktif", diusulkanOleh: 7 };
    const r = await setujuiMemorial({ code: "6300001", id: UUID });
    expect(r.ok).toBe(false);
    expect(updateJurnal()).toHaveLength(0);
  });
});
