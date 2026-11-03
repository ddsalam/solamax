import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Setoran tunai pengawas → Debet Kas Besar otomatis (rencana K6 U5 — R14, R17,
 * AE1, AE4, F1, KTD6) dengan DB TIRUAN BERKEADAAN: `manual_entry`,
 * `cash_ledger`, `cash_account`, dan `cocok_bank_baris` disimulasikan; tulisan
 * baru berlaku saat COMMIT dan hilang saat ROLLBACK; indeks unik parsial 0033
 * ("satu baris kas aktif per setoran") dan trigger 0026 (UPDATE manual_entry
 * pada hari tertutup ditolak) ikut ditegakkan. Hasil diuji dari BARIS YANG
 * TERSIMPAN, bukan dari panggilan internal.
 *
 * ⚠️ Batas: SQL tidak dijalankan; tiruan mencocokkan pernyataan lewat
 * potongan teksnya. RLS, FK, dan `hariBukuTerkunci` yang sebenarnya dibuktikan
 * oleh tes integrasi ber-gerbang env di modul lain — di sini penjaganya ditiru.
 */

type Akun = { id: string; unit_id: number; nama: string; kind: string; active: boolean };
type Entri = {
  id: string;
  unit_id: number;
  business_date: string;
  section: string;
  keterangan: string;
  amount: number;
  void: boolean;
  source_door: string;
  created_by_user_id: number;
};
type Kas = {
  id: string;
  unit_id: number;
  account_id: string;
  business_date: string;
  keterangan: string;
  category_label: string;
  amount: number;
  created_by_user_id: number;
  source_manual_entry_id: string | null;
  void: boolean;
  voided_by_user_id: number | null;
};

const h = vi.hoisted(() => {
  const db = {
    akun: [] as Akun[],
    entri: [] as Entri[],
    kas: [] as Kas[],
    /** Baris kas di kelompok cocok AKTIF (cocok_bank_baris.aktif). */
    dicocokkan: new Set<string>(),
    /** Hari berstatus `closed` — dipakai tiruan trigger 0026. */
    tutup: new Set<string>(),
  };
  let staged: { entri: Entri[]; kas: Kas[] } | null = null;
  let seq = 0;
  const hari = {
    fn: (_u: number, t: string): unknown => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false }),
  };
  const lihatEntri = (): Entri[] => staged!.entri;
  const lihatKas = (): Kas[] => staged!.kas;

  const client = {
    query: async (sql: string, p: unknown[] = []) => {
      const ok = (rows: unknown[] = [], rowCount?: number) => ({ rows, rowCount: rowCount ?? rows.length });
      if (sql === "BEGIN") {
        staged = { entri: db.entri.map((e) => ({ ...e })), kas: db.kas.map((k) => ({ ...k })) };
        return ok();
      }
      if (sql === "COMMIT") {
        db.entri = staged!.entri;
        db.kas = staged!.kas;
        staged = null;
        return ok();
      }
      if (sql === "ROLLBACK") {
        staged = null;
        return ok();
      }
      if (sql.includes("set_config")) return ok();
      if (sql.includes("FROM app.cash_account")) {
        const [unit, nama] = p as [number, string];
        return ok(
          db.akun.filter((a) => a.unit_id === unit && a.kind === "kas" && a.active && a.nama === nama).map((a) => ({ id: a.id })),
        );
      }
      if (sql.includes("INSERT INTO app.manual_entry")) {
        const [unit, date, ket, amount, by] = p as [number, string, string, number, number];
        const id = `me-${++seq}`;
        const e: Entri = {
          id,
          unit_id: unit,
          business_date: date,
          section: "setoran_tunai",
          keterangan: ket,
          amount: Number(amount),
          void: false,
          source_door: "pengawas",
          created_by_user_id: by,
        };
        lihatEntri().push(e);
        return ok([{ id, keterangan: e.keterangan, amount: String(e.amount), tanggal: date }]);
      }
      if (sql.includes("UPDATE app.manual_entry")) {
        const [by, id, unit] = p as [number, string, number];
        const e = lihatEntri().find((x) => x.id === id && x.unit_id === unit && !x.void && x.source_door === "pengawas");
        if (e && db.tutup.has(e.business_date)) {
          throw new Error(`hari sudah ditutup (unit ${unit} tanggal ${e.business_date}): manual_entry ${id} tidak bisa diubah/di-void. Pakai Adjust/Reverse.`);
        }
        if (e) e.void = true;
        void by;
        return ok([], e ? 1 : 0);
      }
      if (sql.includes("FROM app.manual_entry")) {
        const [id, unit] = p as [string, number];
        const e = lihatEntri().find((x) => x.id === id && x.unit_id === unit && !x.void);
        if (sql.includes("source_door")) {
          return ok(e && e.source_door === "pengawas" ? [{ section: e.section }] : []);
        }
        return ok(
          e && e.section === "setoran_tunai"
            ? [{ id: e.id, keterangan: e.keterangan, amount: String(e.amount), tanggal: e.business_date }]
            : [],
        );
      }
      if (sql.includes("INSERT INTO app.cash_ledger")) {
        const [unit, account, date, ket, amount, by, src] = p as [number, string, string, string, string, number, string];
        // Indeks unik parsial 0033 + ON CONFLICT DO NOTHING: baris kedua diam-diam tak lahir.
        if (lihatKas().some((k) => k.source_manual_entry_id === src && !k.void)) return ok([], 0);
        const id = `kas-${++seq}`;
        lihatKas().push({
          id,
          unit_id: unit,
          account_id: account,
          business_date: date,
          keterangan: ket,
          category_label: "Setoran Hasil Penjualan",
          amount: Number(amount),
          created_by_user_id: by,
          source_manual_entry_id: src,
          void: false,
          voided_by_user_id: null,
        });
        return ok([{ id }]);
      }
      if (sql.includes("UPDATE app.cash_ledger")) {
        const [by, src, unit] = p as [number, string, number];
        const kena = lihatKas().filter((k) => k.source_manual_entry_id === src && k.unit_id === unit && !k.void);
        for (const k of kena) {
          k.void = true;
          k.voided_by_user_id = by;
        }
        return ok([], kena.length);
      }
      if (sql.includes("FROM app.cash_ledger")) {
        const [src, unit] = p as [string, number];
        return ok(
          lihatKas()
            .filter((k) => k.source_manual_entry_id === src && k.unit_id === unit && !k.void)
            .map((k) => ({ id: k.id, dicocokkan: db.dicocokkan.has(k.id) })),
        );
      }
      throw new Error(`SQL tak dikenal tiruan: ${sql.slice(0, 80)}`);
    },
    release: () => {},
  };
  const UNIT = { unit_id: 3, code: "6478999", name: "Unit Uji" };
  return { db, client, hari, UNIT, reset: () => { staged = null; seq = 0; } };
});

vi.mock("./db", () => ({ pool: { connect: async () => h.client }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Pemicu jurnal (KTD3 pemicu 1) diuji di buku-besar-pemicu.integration.test.ts.
vi.mock("./buku-besar-tulis", () => ({ bentukJurnalSesudahTulis: vi.fn(async () => ({ dibentuk: [], dilewati: [], gagal: [] })) }));
vi.mock("./hari-buku-queries", () => ({
  hariBukuTerkunci: vi.fn(async (_c: unknown, unitId: number, tanggal: string) => h.hari.fn(unitId, tanggal)),
}));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "pengawas",
    email: "pengawas@solagroup.co",
    units: [h.UNIT],
    requireUnit(code: string) {
      if (code !== h.UNIT.code) throw new Error("NEXT_NOT_FOUND");
      return h.UNIT;
    },
  })),
}));

const { addManualEntry, voidManualEntry } = await import("./manual-entry-actions");
const { postingSetoran, PESAN_TANPA_KAS_BESAR } = await import("./setoran-tulis");
const { pool } = await import("./db");

const KAS_BESAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TGL = "2026-10-12";

const setor = (amount: number, keterangan = "Setoran shift 1") =>
  addManualEntry({ code: h.UNIT.code, date: TGL, section: "setoran_tunai", keterangan, amount });
const batal = (id: string) => voidManualEntry({ code: h.UNIT.code, date: TGL, id });
const kasAktif = () => h.db.kas.filter((k) => !k.void);

beforeEach(() => {
  h.reset();
  h.db.akun = [
    { id: KAS_BESAR, unit_id: 3, nama: "Kas Besar", kind: "kas", active: true },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", unit_id: 3, nama: "Bank Uji", kind: "bank", active: true },
  ];
  h.db.entri = [];
  h.db.kas = [];
  h.db.dicocokkan = new Set();
  h.db.tutup = new Set();
  h.hari.fn = (_u, t) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });
});

describe("Covers AE1 — setoran langsung menjadi debet Kas Besar", () => {
  it("simpan setoran Rp 20.000.000 → satu debet Kas Besar Rp 20.000.000, tertaut ke setorannya, tanpa aksi Finance", async () => {
    expect(await setor(20_000_000)).toEqual({ ok: true });
    const [e] = h.db.entri;
    expect(e).toMatchObject({ section: "setoran_tunai", amount: 20_000_000, void: false });
    expect(kasAktif()).toEqual([
      expect.objectContaining({
        account_id: KAS_BESAR,
        business_date: TGL,
        amount: 20_000_000,
        category_label: "Setoran Hasil Penjualan",
        source_manual_entry_id: e!.id,
        created_by_user_id: 7,
      }),
    ]);
  });

  it("seksi lain (pengeluaran) tidak menyentuh buku kas", async () => {
    expect(
      await addManualEntry({ code: h.UNIT.code, date: TGL, section: "pengeluaran", keterangan: "BELI LAKBAN", amount: 15_000 }),
    ).toEqual({ ok: true });
    // Entri Rincian biasa kini juga ditulis di dalam transaksi (KTD3 pemicu 1);
    // tiruan ini hanya memodelkan INSERT setoran, jadi yang diuji: buku kas tetap kosong.
    expect(h.db.kas).toEqual([]);
  });
});

describe("Covers AE4 — koreksi = batal + buat ulang", () => {
  it("Rp 20.000.000 dikoreksi jadi Rp 19.500.000: baris lama batal & tersimpan, baris baru aktif", async () => {
    await setor(20_000_000);
    const lama = h.db.entri[0]!;
    expect(await batal(lama.id)).toEqual({ ok: true });
    expect(await setor(19_500_000)).toEqual({ ok: true });

    expect(h.db.entri.map((e) => [e.amount, e.void])).toEqual([
      [20_000_000, true],
      [19_500_000, false],
    ]);
    expect(h.db.kas.map((k) => [k.amount, k.void, k.voided_by_user_id])).toEqual([
      [20_000_000, true, 7],
      [19_500_000, false, null],
    ]);
    // Saldo Kas Besar hanya menghitung baris aktif.
    expect(kasAktif().reduce((s, k) => s + k.amount, 0)).toBe(19_500_000);
  });
});

describe("pembatalan yang ditolak", () => {
  it("🔴 baris kas setoran sudah dicocokkan rekening koran → seluruh pembatalan ditolak, diarahkan ke HoF", async () => {
    await setor(20_000_000);
    const e = h.db.entri[0]!;
    h.db.dicocokkan.add(h.db.kas[0]!.id);
    const r = await batal(e.id);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Head of Finance/) });
    expect(h.db.entri[0]!.void).toBe(false);
    expect(kasAktif()).toHaveLength(1);
  });

  it("🔴 hari sudah ditutup → trigger 0026 menolak; setoran dan baris kasnya tetap aktif", async () => {
    await setor(20_000_000);
    h.db.tutup.add(TGL);
    const r = await batal(h.db.entri[0]!.id);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/hari sudah ditutup/) });
    expect(h.db.entri[0]!.void).toBe(false);
    expect(kasAktif()).toHaveLength(1);
  });

  it("setoran lama tanpa baris kas (belum disetujui) tetap bisa dibatalkan", async () => {
    h.db.entri.push({
      id: "me-lama", unit_id: 3, business_date: TGL, section: "setoran_tunai", keterangan: "lama",
      amount: 5_000_000, void: false, source_door: "pengawas", created_by_user_id: 7,
    });
    expect(await batal("me-lama")).toEqual({ ok: true });
    expect(h.db.entri[0]!.void).toBe(true);
  });
});

describe("penolakan simpan — tak ada yang tertulis", () => {
  it("🔴 unit tanpa akun Kas Besar aktif → ditolak dengan pesan jelas; setoran pun tak tersimpan", async () => {
    h.db.akun = h.db.akun.filter((a) => a.kind !== "kas");
    const r = await setor(20_000_000);
    expect(r).toEqual({ ok: false, error: PESAN_TANPA_KAS_BESAR });
    expect(PESAN_TANPA_KAS_BESAR).toMatch(/Kas Besar/);
    expect(h.db.entri).toEqual([]);
    expect(h.db.kas).toEqual([]);
  });

  it("🔴 akun kas bernama lain (bukan \"Kas Besar\") tidak dipakai", async () => {
    h.db.akun = [{ id: KAS_BESAR, unit_id: 3, nama: "Kas Kecil", kind: "kas", active: true }];
    expect(await setor(20_000_000)).toEqual({ ok: false, error: PESAN_TANPA_KAS_BESAR });
    expect(h.db.entri).toEqual([]);
  });

  it("🔴 hari sudah ditutup → setoran ditolak, tidak didorong ke hari lain", async () => {
    h.hari.fn = (_u, t) => ({ status: "dibukukan", hariBuku: "2026-10-13", terdorongMaju: true, perluKodeAlasan: true, _t: t });
    const r = await setor(20_000_000);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/sudah ditutup/) });
    expect(h.db.entri).toEqual([]);
    expect(h.db.kas).toEqual([]);
  });

  it("tanggal sebelum saldo pembuka Kas Besar → setoran tersimpan, TIDAK dibukukan (R22: sudah termuat di saldo pembuka)", async () => {
    h.hari.fn = () => ({ status: "pra-cut-over", cutOver: "2026-10-15" });
    expect(await setor(20_000_000)).toEqual({ ok: true });
    expect(h.db.entri).toHaveLength(1);
    expect(h.db.kas).toEqual([]);
  });
});

describe("idempoten", () => {
  it("posting dua kali untuk setoran yang sama → tetap satu baris kas", async () => {
    await setor(20_000_000);
    const id = h.db.entri[0]!.id;
    const c = await pool.connect();
    await c.query("BEGIN");
    const r = await postingSetoran(c as never, { unitId: 3 as never, manualEntryId: id, aktorId: 7 });
    await c.query("COMMIT");
    expect(r).toEqual({ ok: true, posting: "sudah_ada" });
    expect(kasAktif()).toHaveLength(1);
  });

  it("setoran yang baris kasnya hilang (mis. dibatalkan Finance) bisa diposting ulang sekali", async () => {
    await setor(20_000_000);
    const id = h.db.entri[0]!.id;
    h.db.kas[0]!.void = true;
    const c = await pool.connect();
    await c.query("BEGIN");
    const r1 = await postingSetoran(c as never, { unitId: 3 as never, manualEntryId: id, aktorId: 7 });
    const r2 = await postingSetoran(c as never, { unitId: 3 as never, manualEntryId: id, aktorId: 7 });
    await c.query("COMMIT");
    expect([r1, r2]).toEqual([
      { ok: true, posting: "baru" },
      { ok: true, posting: "sudah_ada" },
    ]);
    expect(kasAktif()).toEqual([expect.objectContaining({ amount: 20_000_000, source_manual_entry_id: id })]);
  });
});
