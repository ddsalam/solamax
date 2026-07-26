import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TES NEGATIF PADA AKSI SERVER `grantAccess` — bukan pada salinan logikanya.
 *
 * Cacat yang dijaga: form "beri akses" dulu meng-upsert `app.user_role`, sementara
 * select Role-nya tak terkendali dan default-nya "Direksi". Menambahkan perusahaan
 * kedua untuk seorang PENGAWAS, tanpa menyentuh select itu, menaikkannya jadi direksi
 * di SEMUA perusahaannya lewat ON UPDATE CASCADE — diam-diam, tanpa satu pun error.
 *
 * Kelas cacat ini tak tertangkap suite lama karena kedua keadaan sama-sama SAH dan
 * uji UI selalu memilih role secara sengaja, sehingga tak pernah melewati jalur
 * default. Karena itu tesnya menekan langsung di aksi server, bukan di UI.
 */
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const scope = {
  userId: 1,
  role: "super_admin" as const,
  email: "owner@example.test",
  tenantIds: [] as string[],
  isSuperAdmin: true,
};
vi.mock("./scope", () => ({ getDataScope: async () => scope }));

/** Query yang dijalankan, berikut jawaban palsunya (dirutekan lewat potongan SQL). */
const queries: { sql: string; params: unknown[] }[] = [];
let roleTersimpan: string | null = null;

vi.mock("./db", () => ({
  q: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes("SELECT role FROM app.user_role")) {
      return roleTersimpan === null ? [] : [{ role: roleTersimpan }];
    }
    if (sql.includes("INSERT INTO app.membership")) return [{ id: "m-baru" }];
    return [];
  },
}));

const { grantAccess } = await import("./admin-actions");

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
};

const TENANT_B = "bbbb2222-2222-2222-2222-222222222222";

beforeEach(() => {
  queries.length = 0;
  revalidatePath.mockClear();
});

describe("grantAccess — form ini TIDAK PERNAH mengubah role", () => {
  it("role BERBEDA dari yang sudah dimiliki → DITOLAK (bukan di-upsert)", async () => {
    roleTersimpan = "pengawas";
    await expect(
      grantAccess(fd({ userId: "7", role: "direksi", tenantId: TENANT_B, unitMode: "all" })),
    ).rejects.toThrow(/forbidden.*sudah ber-role "pengawas"/);
    // dan TIDAK ada satu pun tulisan yang terjadi
    const tulis = queries.filter((x) => /INSERT|UPDATE|DELETE/i.test(x.sql));
    expect(tulis).toEqual([]);
  });

  it("skenario nyata: default 'Direksi' pada seorang PENGAWAS → DITOLAK", async () => {
    // Persis alur yang ditakutkan: admin memilih pengguna + perusahaan + unit,
    // lupa menurunkan select Role dari default "Direksi".
    roleTersimpan = "pengawas";
    await expect(
      grantAccess(
        fd({ userId: "7", role: "direksi", tenantId: TENANT_B, unitMode: "list", unitIds: ["4"] }),
      ),
    ).rejects.toThrow(/forbidden/);
    expect(queries.some((x) => x.sql.includes("app.user_role") && /INSERT/i.test(x.sql))).toBe(false);
  });

  it("role SAMA → lolos, dan user_role TIDAK ditulis ulang", async () => {
    roleTersimpan = "pengawas";
    await grantAccess(
      fd({ userId: "7", role: "pengawas", tenantId: TENANT_B, unitMode: "list", unitIds: ["4"] }),
    );
    expect(queries.some((x) => /INSERT INTO app\.user_role/.test(x.sql))).toBe(false);
    expect(queries.some((x) => /INSERT INTO app\.membership/.test(x.sql))).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("pengguna BARU (belum punya role) → role BOLEH ditetapkan di sini", async () => {
    roleTersimpan = null;
    await grantAccess(
      fd({ userId: "9", role: "direksi", tenantId: TENANT_B, unitMode: "all" }),
    );
    const ins = queries.find((x) => /INSERT INTO app\.user_role/.test(x.sql));
    expect(ins).toBeTruthy();
    expect(ins!.params).toEqual([9, "direksi"]);
  });

  it("ON CONFLICT membership TIDAK lagi menimpa role", async () => {
    roleTersimpan = "pengawas";
    await grantAccess(fd({ userId: "7", role: "pengawas", tenantId: TENANT_B, unitMode: "all" }));
    const upsert = queries.find((x) => /INSERT INTO app\.membership/.test(x.sql))!;
    expect(upsert.sql).toMatch(/DO UPDATE SET status = 'active', all_units = EXCLUDED\.all_units/);
    expect(upsert.sql).not.toMatch(/DO UPDATE SET role/);
  });

  it("all_units=true → daftar unit diabaikan (tidak menulis user_unit)", async () => {
    roleTersimpan = "direksi";
    await grantAccess(
      fd({ userId: "7", role: "direksi", tenantId: TENANT_B, unitMode: "all", unitIds: ["4", "5"] }),
    );
    expect(queries.some((x) => /INSERT INTO app\.user_unit/.test(x.sql))).toBe(false);
  });

  it("unitMode='list' → user_unit ditulis persis unit yang dicentang", async () => {
    roleTersimpan = "pengawas";
    await grantAccess(
      fd({ userId: "7", role: "pengawas", tenantId: TENANT_B, unitMode: "list", unitIds: ["4"] }),
    );
    const ins = queries.filter((x) => /INSERT INTO app\.user_unit/.test(x.sql));
    expect(ins).toHaveLength(1);
    expect(ins[0]!.params).toEqual(["m-baru", 4, TENANT_B]);
  });
});
