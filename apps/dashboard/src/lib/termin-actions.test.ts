import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server action termin pembayaran (rencana 2026-11-13 U4) — perilaku gerbang &
 * validasi dengan DB TIRUAN. Klien tiruan mencatat setiap pernyataan, sehingga
 * "ditolak" dibuktikan sebagai "tak ada koneksi / tak ada INSERT", bukan hanya
 * pesan yang benar.
 *
 * ⚠️ Batas: SQL-nya tidak dijalankan. Penegakan DB (RLS, CHECK, indeks unik
 * parsial 0064) dibuktikan `termin.integration.test.ts` (ber-gerbang env).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string, params: unknown[]) => Jawab } = { jawab: () => undefined };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const revalidatePath = vi.fn();
  const A = { unit_id: 6478, code: "6478111", name: "IB" };
  const B = { unit_id: 6479, code: "6479222", name: "Bakau" };
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null, units: [A, B] };
  return { log, state, connect, revalidatePath, A, B, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(), q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: h.sesi.role,
    email: h.sesi.email,
    units: h.sesi.units,
    requireUnit(code: string) {
      const u = h.sesi.units.find((x) => x.code === code);
      if (!u) throw new Error("NEXT_NOT_FOUND");
      return u;
    },
  })),
}));

const { tetapkanTerminUnit, tetapkanTerminPelanggan, hapusTerminPelanggan } = await import("./termin-actions");

const sebagai = (role: string, email: string | null = "orang@solagroup.co", units = [h.A, h.B]) => {
  h.sesi.role = role;
  h.sesi.email = email;
  h.sesi.units = units;
};
const KEUANGAN = () => sebagai("keuangan", "staf@solagroup.co");
const HOF = () => sebagai("admin_perusahaan", "hof@solagroup.co");
const ke = (potongan: string) => h.log.filter((l) => l.sql.includes(potongan));
const urutanSql = () => h.log.map((l) => l.sql.trim().split(/\s+/).slice(0, 3).join(" "));

/** Jawaban DB tiruan: baris aktif (bila ada) dan master pelanggan. */
const db =
  (o: { aktif?: number | null; master?: boolean }) =>
  (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
    if (sql.includes("FROM public.pelanggan_master")) {
      return { rows: o.master === false ? [] : [{ kode: "NOL/02", nama: "PT Contoh Ilustrasi" }] };
    }
    if (/FROM app\.termin_(unit|pelanggan)/.test(sql)) {
      return { rows: o.aktif == null ? [] : [{ id: "lama-1", terminHari: o.aktif }] };
    }
    if (/UPDATE app\.termin_(unit|pelanggan)/.test(sql)) return { rows: [], rowCount: 1 };
    return undefined;
  };

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.revalidatePath.mockClear();
  h.state.jawab = () => undefined;
  KEUANGAN();
});

describe("gerbang wewenang — tim Finance (canAturTermin), SEBELUM koneksi", () => {
  it("🔴 pengawas, direksi, dan admin_perusahaan non-HoF ditolak di KETIGA aksi, tanpa koneksi", async () => {
    for (const peran of ["pengawas", "direksi", "admin_perusahaan"] as const) {
      sebagai(peran, "orang@solagroup.co");
      for (const r of [
        await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 }),
        await tetapkanTerminPelanggan({ code: h.A.code, kodePelanggan: "NOL/02", terminHari: 14 }),
        await hapusTerminPelanggan({ code: h.A.code, kodePelanggan: "NOL/02" }),
      ]) {
        expect(r, peran).toEqual({ ok: false, error: expect.stringMatching(/tim Finance/) });
      }
    }
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 staf Keuangan, Head of Finance (peran apa pun), dan super_admin BOLEH", async () => {
    for (const s of [KEUANGAN, HOF, () => sebagai("keuangan", "hof@solagroup.co"), () => sebagai("super_admin", "sa@solagroup.co")]) {
      s();
      h.log.length = 0;
      h.state.jawab = db({ aktif: null });
      const r = await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 });
      expect(r.ok, `${h.sesi.role}/${h.sesi.email}`).toBe(true);
      expect(ke("INSERT INTO app.termin_unit")).toHaveLength(1);
    }
  });

  it("🔴 unit di luar scope pengguna: requireUnit melempar — tanpa koneksi, tak ada yang tertulis", async () => {
    sebagai("keuangan", "staf@solagroup.co", [h.A]);
    await expect(tetapkanTerminUnit({ code: h.B.code, terminHari: 30 })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      tetapkanTerminPelanggan({ code: h.B.code, kodePelanggan: "NOL/02", terminHari: 14 }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(hapusTerminPelanggan({ code: h.B.code, kodePelanggan: "NOL/02" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("tetapkanTerminUnit", () => {
  it("BEGIN → set_config SATU unit → INSERT → audit → COMMIT → revalidate", async () => {
    h.state.jawab = db({ aktif: null });
    const r = await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 });
    expect(r).toEqual({ ok: true, pesan: expect.stringMatching(/30 hari/) });
    const u = urutanSql();
    expect(u[0]).toBe("BEGIN");
    expect(h.log[1]!.sql).toContain("set_config('app.unit_ids'");
    expect(h.log[1]!.params).toEqual([String(h.A.unit_id)]);
    expect(u.at(-1)).toBe("COMMIT");
    expect(ke("INSERT INTO app.termin_unit")[0]!.params).toEqual([h.A.unit_id, 30, 7]);
    const audit = ke("INSERT INTO app.audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.params.slice(0, 4)).toEqual([7, "staf@solagroup.co", "termin.unit.tetapkan", h.A.code]);
    expect(h.revalidatePath.mock.calls).toEqual([
      [`/keuangan/unit/${h.A.code}/tagihan`, "layout"],
      ["/keuangan/tagihan"],
    ]);
  });

  it("🔴 ganti = void + insert, SATU baris audit `ganti` dengan nilai lama & baru", async () => {
    h.state.jawab = db({ aktif: 30 });
    expect((await tetapkanTerminUnit({ code: h.A.code, terminHari: 14 })).ok).toBe(true);
    expect(ke("UPDATE app.termin_unit")).toHaveLength(1);
    expect(ke("INSERT INTO app.termin_unit")).toHaveLength(1);
    const audit = ke("INSERT INTO app.audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.params[2]).toBe("termin.unit.ganti");
    expect(JSON.parse(audit[0]!.params[4] as string)).toEqual({
      unit: h.A.code,
      terminHari: 14,
      sebelumnya: { terminHari: 30 },
    });
  });

  it("🔴 nilai SAMA: ok, tetapi tanpa void/insert/audit dan tanpa revalidate", async () => {
    h.state.jawab = db({ aktif: 30 });
    const r = await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 });
    expect(r).toEqual({ ok: true, pesan: expect.stringMatching(/tak ada yang diubah/) });
    expect(ke("UPDATE app.")).toEqual([]);
    expect(ke("INSERT INTO")).toEqual([]);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("🔴 di luar 0..365 / bukan bilangan bulat ditolak SEBELUM koneksi", async () => {
    for (const n of [-1, 366, 7.5, Number.NaN]) {
      expect((await tetapkanTerminUnit({ code: h.A.code, terminHari: n })).ok, String(n)).toBe(false);
    }
    expect((await tetapkanTerminUnit({ code: h.A.code, terminHari: "30" as unknown as number })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("bentrok indeks unik (dua penyimpan pertama bersamaan) ⇒ ROLLBACK + pesan muat ulang", async () => {
    h.state.jawab = (sql) => {
      if (sql.includes("INSERT INTO app.termin_unit")) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return undefined;
    };
    const r = await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/bersamaan/) });
    expect(urutanSql().at(-1)).toBe("ROLLBACK");
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("🔴 galat basis data lain ⇒ pesan umum; teks galat mentah hanya ke log server, tidak ke peramban", async () => {
    const mentah = 'new row for relation "termin_unit" violates check constraint "termin_unit_hari_ck"';
    h.state.jawab = (sql) => {
      if (sql.includes("INSERT INTO app.termin_unit")) throw Object.assign(new Error(mentah), { code: "23514" });
      return undefined;
    };
    const catat = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await tetapkanTerminUnit({ code: h.A.code, terminHari: 30 });
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/^Gagal menyimpan termin bawaan unit\./) });
      if (r.ok) throw new Error("seharusnya gagal");
      expect(r.error).not.toContain("termin_unit");
      expect(r.error).not.toContain("constraint");
      expect(urutanSql().at(-1)).toBe("ROLLBACK");
      expect(h.revalidatePath).not.toHaveBeenCalled();
      // Sebab lengkapnya tetap tercatat di server.
      expect(catat).toHaveBeenCalledTimes(1);
      expect(catat.mock.calls[0]!.some((x) => x instanceof Error && x.message === mentah)).toBe(true);
    } finally {
      catat.mockRestore();
    }
  });
});

describe("tetapkanTerminPelanggan & hapusTerminPelanggan", () => {
  it("pengecualian tersimpan dengan kode master terpangkas; audit ber-target unit/kode", async () => {
    h.state.jawab = db({ aktif: null });
    const r = await tetapkanTerminPelanggan({ code: h.A.code, kodePelanggan: "NOL/02      ", terminHari: 14 });
    expect(r).toEqual({ ok: true, pesan: expect.stringMatching(/NOL\/02.*14 hari/) });
    expect(ke("INSERT INTO app.termin_pelanggan")[0]!.params).toEqual([h.A.unit_id, "NOL/02", 14, 7]);
    const audit = ke("INSERT INTO app.audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.params.slice(2, 4)).toEqual(["termin.pelanggan.tetapkan", `${h.A.code}/NOL/02`]);
  });

  it("🔴 pelanggan tak dikenal master ⇒ ROLLBACK, tak ada INSERT/UPDATE, tanpa revalidate", async () => {
    h.state.jawab = db({ aktif: null, master: false });
    const r = await tetapkanTerminPelanggan({ code: h.A.code, kodePelanggan: "TAKADA", terminHari: 14 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/tak ada di master/) });
    expect(ke("INSERT INTO")).toEqual([]);
    expect(urutanSql().at(-1)).toBe("ROLLBACK");
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("🔴 kode kosong / lebih dari 12 karakter ditolak SEBELUM koneksi", async () => {
    expect((await tetapkanTerminPelanggan({ code: h.A.code, kodePelanggan: "  ", terminHari: 14 })).ok).toBe(false);
    expect((await tetapkanTerminPelanggan({ code: h.A.code, kodePelanggan: "X".repeat(13), terminHari: 14 })).ok).toBe(false);
    expect((await hapusTerminPelanggan({ code: h.A.code, kodePelanggan: "" })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 hapus pengecualian = void TANPA insert; audit `hapus`; revalidate", async () => {
    h.state.jawab = db({ aktif: 14 });
    const r = await hapusTerminPelanggan({ code: h.A.code, kodePelanggan: "NOL/02" });
    expect(r).toEqual({ ok: true, pesan: expect.stringMatching(/kembali memakai termin bawaan unit/) });
    expect(ke("UPDATE app.termin_pelanggan")).toHaveLength(1);
    expect(ke("INSERT INTO app.termin_pelanggan")).toEqual([]);
    expect(h.log.some((l) => /\bDELETE\b/.test(l.sql))).toBe(false);
    const audit = ke("INSERT INTO app.audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.params[2]).toBe("termin.pelanggan.hapus");
    expect(h.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("hapus tanpa pengecualian aktif ⇒ ditolak, ROLLBACK, tak ada audit", async () => {
    h.state.jawab = db({ aktif: null });
    const r = await hapusTerminPelanggan({ code: h.A.code, kodePelanggan: "NOL/02" });
    expect(r.ok).toBe(false);
    expect(ke("INSERT INTO app.audit_log")).toEqual([]);
    expect(urutanSql().at(-1)).toBe("ROLLBACK");
  });
});
