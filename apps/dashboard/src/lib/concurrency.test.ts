import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
  it("mempertahankan urutan hasil sesuai urutan masukan", async () => {
    const delays = [30, 5, 20, 1, 15, 2, 10];
    const out = await mapLimit(delays, 3, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("tidak pernah melewati batas konkurensi", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("daftar kosong → hasil kosong, fn tak pernah dipanggil", async () => {
    let calls = 0;
    expect(
      await mapLimit([], 3, async () => {
        calls += 1;
        return 1;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it("limit lebih besar dari jumlah item aman", async () => {
    expect(await mapLimit([1, 2], 99, async (x) => x * 2)).toEqual([2, 4]);
  });

  it("error menyebar (tidak ditelan diam-diam)", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
