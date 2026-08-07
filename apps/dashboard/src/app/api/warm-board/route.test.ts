import { describe, expect, it, vi } from "vitest";

/**
 * PEMAKUAN PROPERTI — bukan uji fungsional.
 *
 * `route.ts` melakukan cast `u.unit_id as ScopedUnitId` di luar `getDataScope()`
 * — salah satu dari hanya DUA pencetak `ScopedUnitId` di kode produksi. Cast itu
 * dibenarkan oleh SATU properti, tertulis di komentarnya:
 *
 *     "cast sah di sini karena TIDAK ada data yang keluar ke pemanggil (204)"
 *
 * Sampai sekarang TAK ADA yang menegakkan properti itu. Satu edit yang
 * menambahkan body debug (`{ units, calls }` terasa tak berbahaya) akan
 * MENCABUT pembenaran cast-nya tanpa menyalakan apa pun — dan route ini
 * dijangkau siapa pun yang memegang shared secret, di luar RBAC.
 *
 * Tes ini memaku tepat asumsi yang menopang pengecualian itu.
 */
vi.mock("@/lib/db", () => ({
  q: vi.fn(async () => [{ unit_id: 1, code: "6478111" }]),
  qScoped: vi.fn(async () => []),
  pool: {},
}));
vi.mock("@/lib/gl-window", () => ({ getDailyGlWindow: vi.fn(async () => []) }));
vi.mock("@/lib/saldo-cache", () => ({ getSaldoPelangganCached: vi.fn(async () => ({})) }));

// ≥32 karakter: `isWarmAuthorized` menolak secret pendek (board-warm.ts:51) —
// aturan pertahanan tersendiri, dan tes pertama saya melanggarnya (11 char → 401).
const SECRET = "rahasia-uji-cukup-panjang-32-karakter";
const post = async (header?: string) => {
  const { POST } = await import("./route");
  return POST(
    new Request("https://x/api/warm-board", {
      method: "POST",
      headers: header === undefined ? {} : { "x-warm-secret": header },
    }),
  );
};

describe("/api/warm-board — perimeter cast ScopedUnitId", () => {
  it("SUKSES: 204 dan body BENAR-BENAR kosong (pembenaran cast)", async () => {
    vi.stubEnv("WARM_BOARD_SECRET", SECRET);
    const res = await post(SECRET);
    expect(res.status).toBe(204);
    expect(res.body, "204 tak boleh membawa stream body").toBeNull();
    expect(await res.text(), "body harus kosong — cast ScopedUnitId bergantung padanya").toBe("");
    vi.unstubAllEnvs();
  });

  it("TANPA kredensial: 401 dan body kosong", async () => {
    vi.stubEnv("WARM_BOARD_SECRET", SECRET);
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    vi.unstubAllEnvs();
  });

  it("kredensial SALAH: 401, tak pernah 204", async () => {
    vi.stubEnv("WARM_BOARD_SECRET", SECRET);
    const res = await post("salah");
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(204);
    vi.unstubAllEnvs();
  });

  it("secret SERVER terlalu pendek (<32) → 401 walau header cocok", async () => {
    // Ditemukan lewat tes saya sendiri yang gagal: aturan panjang minimum itu
    // nyata, dan ia mencegah secret lemah menjaga perimeter cast.
    vi.stubEnv("WARM_BOARD_SECRET", "pendek");
    expect((await post("pendek")).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
