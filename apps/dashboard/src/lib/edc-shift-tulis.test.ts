import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Posting otomatis EDC per shift (rencana K6 U6 — R15, R16, AE3, KTD6, KTD7)
 * dengan DB TIRUAN BERKEADAAN: tabel `edc_shift_cek` dan `cash_ledger`
 * disimulasikan, tulisan baru berlaku saat COMMIT dan hilang saat ROLLBACK,
 * dan indeks unik "satu posting aktif per cek" (0043) ikut ditegakkan. Hasil
 * diuji dari BARIS YANG TERSIMPAN, bukan dari panggilan internal.
 *
 * ⚠️ Batas: SQL tidak dijalankan; tiruan mencocokkan pernyataan lewat
 * potongan teksnya. RLS, trigger hari tertutup, dan FK dibuktikan oleh tes
 * integrasi ber-gerbang env di modul lain — tidak ditambah di sini.
 */

type Cek = {
  id: string;
  unit_id: number;
  business_date: string;
  cshift: string;
  acquirer: string;
  easymax_rp: number;
  slip_rp: number;
  checked_by_user_id: number;
  reason_code: string | null;
  void: boolean;
};
type Kas = { id: string; account_id: string; business_date: string; amount: number; edc_shift_cek_id: string; void: boolean; created_by_user_id: number; tanggal_asal?: string | null; alasan_maju?: string | null };

const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  const db = {
    easymax: [] as { cshift: string; ckdkartu: string; rp: number }[],
    peta: [] as { ckdkartu: string; acquirer: string }[],
    akunEdc: [] as { id: string }[],
    kodeAlasan: ["CLS-SLIP"] as string[],
    cek: [] as Cek[],
    kas: [] as Kas[],
  };
  let staged: { cek: Cek[]; kas: Kas[] } | null = null;
  let seq = 0;
  const hari = { fn: (_u: number, t: string): unknown => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false }) };

  const lihatCek = (): Cek[] => staged!.cek;
  const lihatKas = (): Kas[] => staged!.kas;
  const dibukukan = (id: string) => lihatKas().some((l) => l.edc_shift_cek_id === id && !l.void);

  const client = {
    query: async (sql: string, p: unknown[] = []) => {
      const ok = (rows: unknown[] = [], rowCount?: number) => ({ rows, rowCount: rowCount ?? rows.length });
      if (sql === "BEGIN") {
        staged = { cek: db.cek.map((c) => ({ ...c })), kas: db.kas.map((k) => ({ ...k })) };
        return ok();
      }
      if (sql === "COMMIT") {
        db.cek = staged!.cek;
        db.kas = staged!.kas;
        staged = null;
        return ok();
      }
      if (sql === "ROLLBACK") {
        staged = null;
        return ok();
      }
      if (sql.includes("set_config")) return ok();
      if (sql.includes("FROM public.edc")) return ok(db.easymax);
      if (sql.includes("FROM app.edc_kartu_acquirer")) return ok(db.peta);
      if (sql.includes("FROM app.cash_account")) return ok(db.akunEdc.map((a) => ({ id: a.id, cutOver: null })));
      if (sql.includes("FROM app.reason_code")) {
        const kode = p[0] as string | undefined;
        return ok(db.kodeAlasan.filter((c) => kode === undefined || c === kode).map((code) => ({ code })));
      }
      if (sql.includes("INSERT INTO app.edc_shift_cek")) {
        const [unit, date, cshift, acquirer, easymax, slip, , by] = p as [number, string, string, string, number, number, unknown, number];
        const dup = lihatCek().some((c) => !c.void && c.unit_id === unit && c.business_date === date && c.cshift === cshift && c.acquirer === acquirer);
        if (dup) throw new Error("duplicate key value violates unique constraint \"edc_shift_cek_aktif_uq\"");
        const id = `cek-${++seq}`;
        lihatCek().push({ id, unit_id: unit, business_date: date, cshift, acquirer, easymax_rp: Number(easymax), slip_rp: Number(slip), checked_by_user_id: by, reason_code: null, void: false });
        return ok([{ id }]);
      }
      if (sql.includes("UPDATE app.edc_shift_cek SET void")) {
        const c = lihatCek().find((x) => x.id === p[1] && !x.void);
        if (c) c.void = true;
        return ok([], c ? 1 : 0);
      }
      if (sql.includes("UPDATE app.edc_shift_cek SET reason_code")) {
        const c = lihatCek().find((x) => x.id === p[1]);
        if (c) c.reason_code = p[0] as string;
        return ok([], c ? 1 : 0);
      }
      if (sql.includes("FROM app.edc_shift_cek")) {
        const rowOf = (c: Cek) => ({
          id: c.id,
          cshift: c.cshift,
          acquirer: c.acquirer,
          easymaxRp: String(c.easymax_rp),
          slipRp: String(c.slip_rp),
          checkedByUserId: c.checked_by_user_id,
          dibukukan: dibukukan(c.id),
        });
        if (sql.includes("k.id = $1::uuid")) {
          const [id, unit, date] = p as [string, number, string];
          return ok(lihatCek().filter((c) => c.id === id && c.unit_id === unit && c.business_date === date && !c.void).map(rowOf));
        }
        const [unit, date, cshift, acquirer] = p as [number, string, string, string];
        const kunci = lihatCek().filter((c) => c.unit_id === unit && c.business_date === date && c.cshift === cshift && c.acquirer === acquirer);
        if (sql.includes("NOT k.void")) return ok(kunci.filter((c) => !c.void).map(rowOf));
        // Riwayat KTD7 — termasuk cek yang sudah batal.
        return ok(kunci.map((c) => ({ slipRp: c.slip_rp, easymaxRp: c.easymax_rp })));
      }
      if (sql.includes("INSERT INTO app.cash_ledger")) {
        const [, account, date, , amount, by, cekId, asal, maju] = p as [number, string, string, string, number, number, string, string | null, string | null];
        if (lihatKas().some((l) => l.edc_shift_cek_id === cekId && !l.void)) {
          throw new Error("duplicate key value violates unique constraint \"cash_ledger_edc_shift_cek_uq\"");
        }
        const id = `kas-${++seq}`;
        lihatKas().push({ id, account_id: account, business_date: date, amount: Number(amount), edc_shift_cek_id: cekId, void: false, created_by_user_id: by, tanggal_asal: asal ?? null, alasan_maju: maju ?? null });
        return ok([{ id }]);
      }
      throw new Error(`SQL tak dikenal tiruan: ${sql.slice(0, 80)}`);
    },
    release: () => {},
  };
  const sesi = { userId: 7, role: "pengawas", email: "pengawas@solagroup.co" as string | null };
  const UNIT = { unit_id: 3, code: "6478999", name: "Unit Uji" };
  return { db, client, hari, sesi, UNIT, reset: () => { staged = null; seq = 0; } };
});

vi.mock("./db", () => ({ pool: { connect: async () => h.client }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./hari-buku-queries", () => ({
  hariBukuTerkunci: vi.fn(async (_c: unknown, unitId: number, tanggal: string) => h.hari.fn(unitId, tanggal)),
}));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: h.sesi.userId,
    role: h.sesi.role,
    email: h.sesi.email,
    units: [h.UNIT],
    requireUnit(code: string) {
      if (code !== h.UNIT.code) throw new Error("NEXT_NOT_FOUND");
      return h.UNIT;
    },
  })),
}));

const { cekSlipEdc, setujuiPenjualanEdc } = await import("./edc-shift-actions");

const AKUN_EDC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TGL = "2026-10-12";

const sebagaiPengawas = (userId = 7) => Object.assign(h.sesi, { userId, role: "pengawas", email: "pengawas@solagroup.co" });
const sebagaiKeuangan = (userId = 9) => Object.assign(h.sesi, { userId, role: "keuangan", email: "staf@solagroup.co" });
const cek = (cshift: string, slipRp: number) =>
  cekSlipEdc({ code: h.UNIT.code, date: TGL, cshift, acquirer: "BRI", slipRp });
const kasAktif = () => h.db.kas.filter((k) => !k.void);
const cekAktif = (cshift: string) => h.db.cek.find((c) => c.cshift === cshift && !c.void)!;

beforeEach(() => {
  h.reset();
  h.db.easymax = [
    { cshift: "2", ckdkartu: "BRI1", rp: 8_000_000 },
    { cshift: "3", ckdkartu: "BRI1", rp: 8_000_000 },
  ];
  h.db.peta = [{ ckdkartu: "BRI1", acquirer: "BRI" }];
  h.db.akunEdc = [{ id: AKUN_EDC }];
  h.db.cek = [];
  h.db.kas = [];
  h.hari.fn = (_u, t) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });
  sebagaiPengawas();
});

describe("AE3 — cek slip pengawas", () => {
  it("shift 2: slip Rp 8.000.000 = EasyMax Rp 8.000.000 → terposting ke EDC Penampungan sebesar bruto EasyMax", async () => {
    const r = await cek("2", 8_000_000);
    expect(r).toEqual({ ok: true, posting: "terposting" });
    expect(kasAktif()).toEqual([
      expect.objectContaining({ account_id: AKUN_EDC, business_date: TGL, amount: 8_000_000, edc_shift_cek_id: cekAktif("2").id }),
    ]);
  });

  it("shift 3: slip Rp 7.950.000 vs EasyMax Rp 8.000.000 → ditahan; cek tersimpan, buku tak berubah", async () => {
    const r = await cek("3", 7_950_000);
    expect(r).toEqual({ ok: true, posting: "ditahan" });
    expect(cekAktif("3")).toMatchObject({ slip_rp: 7_950_000, easymax_rp: 8_000_000 });
    expect(kasAktif()).toEqual([]);
  });
});

describe("KTD7 — sekali beda tetap ditahan", () => {
  it("cek ulang dengan slip = EasyMax sesudah pernah beda → tetap ditahan", async () => {
    await cek("3", 7_950_000);
    const r = await cek("3", 8_000_000);
    expect(r).toEqual({ ok: true, posting: "ditahan" });
    expect(h.db.cek.filter((c) => c.cshift === "3").map((c) => [c.slip_rp, c.void])).toEqual([
      [7_950_000, true],
      [8_000_000, false],
    ]);
    expect(kasAktif()).toEqual([]);
  });

  it("riwayat beda di shift LAIN tidak menahan shift ini", async () => {
    await cek("3", 7_950_000);
    expect(await cek("2", 8_000_000)).toEqual({ ok: true, posting: "terposting" });
  });
});

describe("tidak terposting dua kali", () => {
  it("cek ulang shift yang sudah terposting ditolak; tetap satu baris buku", async () => {
    await cek("2", 8_000_000);
    const r = await cek("2", 8_000_000);
    expect(r.ok).toBe(false);
    expect(kasAktif()).toHaveLength(1);
  });

  it("Finance menyetujui cek yang sudah terposting otomatis → tak ada baris kedua", async () => {
    await cek("2", 8_000_000);
    sebagaiKeuangan();
    const r = await setujuiPenjualanEdc({ code: h.UNIT.code, date: TGL, pilihan: [{ cekId: cekAktif("2").id, reasonCode: null }] });
    expect(r).toEqual({ ok: true, n: 0 });
    expect(kasAktif()).toHaveLength(1);
  });
});

describe("jalur Finance untuk yang ditahan (R16)", () => {
  it("selisih tanpa kode alasan ditolak; dengan kode alasan dibukukan sebesar bruto EasyMax", async () => {
    await cek("3", 7_950_000);
    const id = cekAktif("3").id;
    sebagaiKeuangan();
    const tanpa = await setujuiPenjualanEdc({ code: h.UNIT.code, date: TGL, pilihan: [{ cekId: id, reasonCode: null }] });
    expect(tanpa.ok).toBe(false);
    expect(kasAktif()).toEqual([]);

    const dengan = await setujuiPenjualanEdc({ code: h.UNIT.code, date: TGL, pilihan: [{ cekId: id, reasonCode: "CLS-SLIP" }] });
    expect(dengan).toEqual({ ok: true, n: 1 });
    expect(kasAktif()).toEqual([expect.objectContaining({ amount: 8_000_000, edc_shift_cek_id: id, created_by_user_id: 9 })]);
    expect(cekAktif("3").reason_code).toBe("CLS-SLIP");
  });

  it("🔴 yang mencocokkan tidak menyetujui cek yang sama", async () => {
    await cek("3", 7_950_000);
    const id = cekAktif("3").id;
    sebagaiKeuangan(7); // akun yang sama dengan pengawas yang mencocokkan
    const r = await setujuiPenjualanEdc({ code: h.UNIT.code, date: TGL, pilihan: [{ cekId: id, reasonCode: "CLS-SLIP" }] });
    expect(r.ok).toBe(false);
    expect(kasAktif()).toEqual([]);
  });
});

describe("penjaga hari & akun (KTD6)", () => {
  it("hari sudah ditutup → tidak didorong maju diam-diam; cek tersimpan sebagai ditahan", async () => {
    h.hari.fn = (_u, t) => ({ status: "dibukukan", hariBuku: "2026-10-13", terdorongMaju: t !== "2026-10-13", perluKodeAlasan: true });
    const r = await cek("2", 8_000_000);
    expect(r).toMatchObject({ ok: true, posting: "ditahan" });
    expect(cekAktif("2")).toBeDefined();
    expect(kasAktif()).toEqual([]);
  });

  it("Finance memutuskan shift ditahan pada hari yang sudah ditutup → dibukukan maju dengan tanggal asal (temuan review #3)", async () => {
    await cek("3", 7_950_000); // ditahan: slip ≠ EasyMax
    const id = cekAktif("3").id;
    // Hari itu kini sudah ditutup: hari buka berikutnya 2 hari kemudian.
    h.hari.fn = (_u, t) => ({ status: "dibukukan", hariBuku: "2026-10-16", terdorongMaju: t !== "2026-10-16", perluKodeAlasan: t !== "2026-10-16" });
    sebagaiKeuangan();
    const r = await setujuiPenjualanEdc({ code: h.UNIT.code, date: TGL, pilihan: [{ cekId: id, reasonCode: "CLS-SLIP" }] });
    expect(r.ok).toBe(true);
    expect(kasAktif()).toEqual([
      expect.objectContaining({ business_date: "2026-10-16", tanggal_asal: TGL, alasan_maju: "ADJ-FWD-EDC", edc_shift_cek_id: id }),
    ]);
  });

  it("tanggal sebelum saldo pembuka → ditahan, tak ada baris buku", async () => {
    h.hari.fn = () => ({ status: "pra-cut-over", cutOver: "2026-10-15" });
    const r = await cek("2", 8_000_000);
    expect(r).toMatchObject({ ok: true, posting: "ditahan" });
    expect(kasAktif()).toEqual([]);
  });

  it("unit tanpa akun EDC Penampungan → ditahan dengan alasan yang terbaca", async () => {
    h.db.akunEdc = [];
    const r = await cek("2", 8_000_000);
    expect(r).toMatchObject({ ok: true, posting: "ditahan" });
    expect(r.ok && r.alasanTahan).toMatch(/EDC Penampungan/);
    expect(kasAktif()).toEqual([]);
  });
});
