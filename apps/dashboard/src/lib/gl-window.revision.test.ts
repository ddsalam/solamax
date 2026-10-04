import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  revision: "sales:a|opname:a|delivery:a|terra_resmi:a|masters:a",
  gl: 4000,
  provisional: false,
  excluded: 0,
  nullValue: false,
  product: "BB-06" as string | null,
  cache: new Map<string, unknown>(),
  reads: 0,
  revisions: 0,
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keys: string[]) => async () => {
    const key = keys.join("|");
    if (!state.cache.has(key)) state.cache.set(key, await fn());
    return state.cache.get(key);
  },
}));
vi.mock("./periods", async (original) => ({
  ...await original<typeof import("./periods")>(), todayWib: () => "2026-10-04",
}));
vi.mock("./queries", () => ({
  getGlSourceRevision: async () => { state.revisions++; return state.revision; },
  getDailyGlByProduct: async (unit: number, from: string, to: string) => {
    state.reads++;
    return [{d:to,ckdbbm:state.product,nama:"DEXLITE",fisik:6000,fisik_prev:9000,
      pen_do:state.gl === 4000 ? 0 : 4000,sales_gross:7000,tera:0,
      gl:state.nullValue ? null : state.gl + (unit === 99 ? 10 : 0),excluded_tanks:state.excluded,
      movement_invalid:false, provisional:state.provisional}];
  },
}));
import { getDailyGlWindow } from "./gl-window";
import type { ScopedUnitId } from "./scope-rule";
const U = 2 as ScopedUnitId;

beforeEach(() => {
  state.revision = "sales:a|opname:a|delivery:a|terra_resmi:a|masters:a";
  state.gl=4000; state.provisional=false; state.excluded=0;state.nullValue=false;
  state.product="BB-06";
  state.cache.clear();state.reads=0;state.revisions=0;
});

describe("source-aware G/L cache", () => {
  it.each(["v2", "v3"])("retires %s rows even when the source revision has not changed", async version => {
    const oldKey = [`gl-window-${version}`, String(U), "2026-10-02", "2026-10-02", state.revision].join("|");
    state.cache.set(oldKey, [{ d: "2026-10-02", ckdbbm: "BB-06", gl: 4000, provisional: false }]);
    state.gl=0;
    expect((await getDailyGlWindow(U,"2026-10-02","2026-10-02"))[0]!.gl).toBe(0);
    expect(state.reads).toBe(1);
    expect([...state.cache.keys()].some(k => k.startsWith("gl-window-v4|"))).toBe(true);
  });
  it.each([null, "", "   "])("does not reuse a final-looking unknown product (%s)", async (product) => {
    state.product=product;
    await getDailyGlWindow(U,"2026-10-02","2026-10-02");
    const before=state.reads;
    state.product="BB-06";state.gl=0;
    expect((await getDailyGlWindow(U,"2026-10-02","2026-10-02"))[0]!.gl).toBe(0);
    expect(state.reads).toBe(before+1);
  });
  it("late 4000 L receipt invalidates previously final day AND MTD cache entries", async () => {
    expect((await getDailyGlWindow(U,"2026-10-01","2026-10-02"))[0]!.gl).toBe(4000);
    expect((await getDailyGlWindow(U,"2026-10-02","2026-10-02"))[0]!.gl).toBe(4000);
    state.revision="sales:a|opname:a|delivery:b|terra_resmi:a|masters:a";
    state.gl=0;
    const day=await getDailyGlWindow(U,"2026-10-02","2026-10-02");
    const month=await getDailyGlWindow(U,"2026-10-01","2026-10-02");
    expect(day[0]!.gl).toBe(0);
    expect(month[0]!.gl).toBe(day[0]!.gl);
    expect(state.reads).toBe(4);
  });
  it("unchanged complete snapshot remains cached and units remain isolated", async () => {
    await getDailyGlWindow(U,"2026-10-01","2026-10-02");
    await getDailyGlWindow(U,"2026-10-01","2026-10-02");
    expect(state.reads).toBe(1);
    expect((await getDailyGlWindow(99 as ScopedUnitId,"2026-10-01","2026-10-02"))[0]!.gl).toBe(4010);
  });
  it.each(["provisional","excluded","null"])("historical %s rows are re-read even before source token changes", async (quality) => {
    state.provisional=quality==="provisional";state.excluded=quality==="excluded" ? 1 : 0;state.nullValue=quality==="null";
    await getDailyGlWindow(U,"2026-10-01","2026-10-02");
    const before=state.reads;
    state.provisional=false;state.excluded=0;state.nullValue=false;state.gl=0;
    expect((await getDailyGlWindow(U,"2026-10-01","2026-10-02"))[0]!.gl).toBe(0);
    expect(state.reads).toBe(before+1);
  });
  it("yesterday and today use fresh queries without revision/cache reads", async () => {
    await getDailyGlWindow(U,"2026-10-03","2026-10-04");
    state.gl=0;
    expect((await getDailyGlWindow(U,"2026-10-03","2026-10-04"))[0]!.gl).toBe(0);
    expect(state.reads).toBe(2);expect(state.revisions).toBe(0);
  });
});
