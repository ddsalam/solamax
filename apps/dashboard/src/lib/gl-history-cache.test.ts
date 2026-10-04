import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createGlHistoryCache } from "./gl-history-cache";
import type { DailyGlRow } from "./queries";

// All inputs are synthetic. No Next.js runtime, database, or wall-clock sleeps.
const row = (gl = 0, overrides: Partial<DailyGlRow> = {}): DailyGlRow => ({
  d: "2026-10-01", ckdbbm: "BB-03", nama: "SOLAR", fisik: 1000,
  fisik_prev: 1000, pen_do: 0, sales_gross: 0, tera: 0, gl,
  movement_invalid: false, excluded_tanks: 0, provisional: false, ...overrides,
});
const canCache = (rows: readonly DailyGlRow[]) => rows.length > 0 && rows.every(r =>
  r.gl !== null && !r.provisional && r.movement_invalid === false
  && r.excluded_tanks === 0 && typeof r.ckdbbm === "string" && r.ckdbbm.trim() !== "",
);
type Cache = ReturnType<typeof createGlHistoryCache>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function source(revision = "revision-1", rows: DailyGlRow[] = [row()]) {
  return {
    readRevision: vi.fn(async () => revision),
    load: vi.fn(async () => rows),
  };
}
function get(cache: Cache, key: string, revision = "revision-1", rows = [row()]) {
  return cache.get(key, source(revision, rows));
}
function retainedBytes(key: string, revision: string, rows: DailyGlRow[]) {
  return Buffer.byteLength(key, "utf8") + Buffer.byteLength(revision, "utf8")
    + Buffer.byteLength(JSON.stringify(rows), "utf8");
}
function blockedLoad() {
  const started = deferred<void>();
  const result = deferred<DailyGlRow[]>();
  const load = vi.fn(() => { started.resolve(); return result.promise; });
  return { started, result, load };
}

describe("historical G/L cache revisions and result ownership", () => {
  it("retains a complete true-zero result and checks the current revision on every hit", async () => {
    const cache = createGlHistoryCache(canCache);
    const inputs = source("1", [row(0)]);
    expect(await cache.get("unit:1:day", inputs)).toEqual([row(0)]);
    expect(inputs.readRevision).toHaveBeenCalledTimes(2); // before and after the fill
    for (let i = 0; i < 5; i++) expect(await cache.get("unit:1:day", inputs)).toEqual([row(0)]);
    expect(inputs.load).toHaveBeenCalledTimes(1);
    expect(inputs.readRevision).toHaveBeenCalledTimes(7);
    expect(cache.stats()).toEqual({ entries: 1, bytes: retainedBytes("unit:1:day", "1", [row(0)]), pending: 0 });
  });

  it("isolates stable keys and replaces only the value for a changed revision", async () => {
    const cache = createGlHistoryCache(canCache);
    await get(cache, "unit:1:day", "1", [row(4000)]);
    await get(cache, "unit:2:day", "1", [row(10)]);
    await get(cache, "unit:1:month", "1", [row(30)]);
    expect(await get(cache, "unit:1:day", "2", [row(0)])).toEqual([row(0)]);
    const day = source("2", [row(999)]);
    const otherUnit = source("1", [row(999)]);
    const month = source("1", [row(999)]);
    expect(await cache.get("unit:1:day", day)).toEqual([row(0)]);
    expect(await cache.get("unit:2:day", otherUnit)).toEqual([row(10)]);
    expect(await cache.get("unit:1:month", month)).toEqual([row(30)]);
    expect(day.load).not.toHaveBeenCalled();
    expect(otherUnit.load).not.toHaveBeenCalled();
    expect(month.load).not.toHaveBeenCalled();
    expect(cache.stats().entries).toBe(3);
  });

  it("does not resurrect earlier content across A → B → A with revision counters 1 → 2 → 3", async () => {
    const cache = createGlHistoryCache(canCache);
    const a = [row(5)];
    const b = [row(9)];
    await get(cache, "window", "1", a);
    await get(cache, "window", "2", b);
    const revisitedA = source("3", a);
    expect(await cache.get("window", revisitedA)).toEqual(a);
    expect(revisitedA.load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 1, bytes: retainedBytes("window", "3", a), pending: 0 });
    const repeat = source("3", b);
    expect(await cache.get("window", repeat)).toEqual(a);
    expect(repeat.load).not.toHaveBeenCalled();
  });

  it("gives the loader and every cache reader separate arrays and flat row objects", async () => {
    const cache = createGlHistoryCache(canCache);
    const original = [row(7)];
    const inputs = source("1", original);
    const first = await cache.get("window", inputs);
    expect(first).not.toBe(original);
    expect(first[0]).not.toBe(original[0]);
    original[0]!.gl = 111;
    original.push(row(222));
    first[0]!.gl = 333;
    first.push(row(444));
    const hit = await cache.get("window", inputs);
    expect(hit).toEqual([row(7)]);
    hit[0]!.gl = 555;
    hit.length = 0;
    expect(await cache.get("window", inputs)).toEqual([row(7)]);
    expect(inputs.load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["empty", []],
    ["provisional", [row(0, { provisional: true })]],
    ["null G/L", [row(0, { gl: null })]],
    ["invalid movement", [row(0, { movement_invalid: true })]],
    ["excluded tanks", [row(0, { excluded_tanks: 1 })]],
    ["unknown product", [row(0, { ckdbbm: null })]],
  ] as const)("returns %s data but never retains it", async (_label, invalid) => {
    const cache = createGlHistoryCache(canCache);
    const rows = [...invalid];
    const inputs = source("1", rows);
    const first = await cache.get("window", inputs);
    expect(first).toEqual(rows);
    expect(first).not.toBe(rows);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    await cache.get("window", inputs);
    expect(inputs.load).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  });

  it("applies the supplied admission predicate and does not keep an older revision after a rejected fill", async () => {
    const predicate = vi.fn((rows: readonly DailyGlRow[]) => rows[0]?.gl === 1);
    const cache = createGlHistoryCache(predicate);
    await get(cache, "window", "1", [row(1)]);
    expect(await get(cache, "window", "2", [row(2)])).toEqual([row(2)]);
    expect(predicate).toHaveBeenCalledWith([row(2)]);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    const retry = source("2", [row(1)]);
    await cache.get("window", retry);
    expect(retry.load).toHaveBeenCalledTimes(1);
  });
});

describe("historical G/L cache concurrent revision lifecycle", () => {
  it("coalesces a same-key, same-revision fill and clones results for its waiters", async () => {
    const cache = createGlHistoryCache(canCache);
    const fill = blockedLoad();
    const inputs = { readRevision: vi.fn(async () => "1"), load: fill.load };
    const first = cache.get("window", inputs);
    await fill.started.promise;
    const second = cache.get("window", inputs);
    const third = cache.get("window", inputs);
    const original = [row(7)];
    fill.result.resolve(original);
    const [a, b, c] = await Promise.all([first, second, third]);
    expect(fill.load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(original);
    expect(a).not.toBe(original);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a[0]).not.toBe(b[0]);
    expect(b[0]).not.toBe(c[0]);
    a[0]!.gl = 123;
    b.push(row(456));
    expect(c).toEqual([row(7)]);
    expect(await get(cache, "window", "1", [row(999)])).toEqual([row(7)]);
    expect(cache.stats().pending).toBe(0);
  });

  it("lets a superseded fill finish for its caller without overwriting a newer completed fill", async () => {
    const cache = createGlHistoryCache(canCache);
    const old = blockedLoad();
    const oldRequest = cache.get("window", { readRevision: async () => "1", load: old.load });
    await old.started.promise;
    expect(await get(cache, "window", "2", [row(20)])).toEqual([row(20)]);
    old.result.resolve([row(10)]);
    expect(await oldRequest).toEqual([row(10)]);
    const current = source("2", [row(999)]);
    expect(await cache.get("window", current)).toEqual([row(20)]);
    expect(current.load).not.toHaveBeenCalled();
    expect(cache.stats()).toEqual({ entries: 1, bytes: retainedBytes("window", "2", [row(20)]), pending: 0 });
  });

  it.each(["resolve", "reject"] as const)("an old fill cannot clear a newer in-flight registration when it %ss", async outcome => {
    const cache = createGlHistoryCache(canCache);
    const old = blockedLoad();
    const current = blockedLoad();
    const oldRequest = cache.get("window", { readRevision: async () => "1", load: old.load });
    // Attach the rejection observer before intentionally rejecting a deferred fill.
    const oldObserved = oldRequest.then(value => ({ value }), error => ({ error }));
    await old.started.promise;
    const inputs = { readRevision: async () => "2", load: current.load };
    const currentRequest = cache.get("window", inputs);
    await current.started.promise;
    if (outcome === "resolve") old.result.resolve([row(1)]);
    else old.result.reject(new Error("old fill failed"));
    const observed = await oldObserved;
    if (outcome === "reject") expect(observed).toEqual({ error: new Error("old fill failed") });
    else expect(observed).toEqual({ value: [row(1)] });
    expect(cache.stats().pending).toBe(1);
    const joined = cache.get("window", inputs);
    current.result.resolve([row(2)]);
    expect(await currentRequest).toEqual([row(2)]);
    expect(await joined).toEqual([row(2)]);
    expect(current.load).toHaveBeenCalledTimes(1);
    expect(cache.stats().pending).toBe(0);
  });

  it("cannot publish revision 1 over revision 3 when content changes A → B → A while the first fill runs", async () => {
    const cache = createGlHistoryCache(canCache);
    const oldA = blockedLoad();
    const first = cache.get("window", { readRevision: async () => "1", load: oldA.load });
    await oldA.started.promise;
    await get(cache, "window", "2", [row(2)]);
    await get(cache, "window", "3", [row(1)]);
    oldA.result.resolve([row(1)]);
    await first;
    const newest = source("3", [row(999)]);
    expect(await cache.get("window", newest)).toEqual([row(1)]);
    expect(newest.load).not.toHaveBeenCalled();
    expect(cache.stats().bytes).toBe(retainedBytes("window", "3", [row(1)]));
  });

  it("reserves admission before revision I/O and a late older lookup cannot evict a later completed value", async () => {
    const cache = createGlHistoryCache(canCache);
    const oldRevision = deferred<string>();
    const oldInputs = {
      readRevision: () => oldRevision.promise,
      verifyRevision: async () => "1",
      load: vi.fn(async () => [row(1)]),
    };
    const older = cache.get("window", oldInputs);
    expect(cache.stats().pending).toBe(1);
    expect(await get(cache, "window", "2", [row(2)])).toEqual([row(2)]);
    oldRevision.resolve("1");
    expect(await older).toEqual([row(1)]);
    const newest = source("2", [row(999)]);
    expect(await cache.get("window", newest)).toEqual([row(2)]);
    expect(newest.load).not.toHaveBeenCalled();
    expect(cache.stats().pending).toBe(0);
  });

  it("an older lookup with the exact revision can reuse a later completed value", async () => {
    const cache = createGlHistoryCache(canCache);
    const late = deferred<string>();
    const lateLoad = vi.fn(async () => [row(999)]);
    const older = cache.get("window", { readRevision: () => late.promise, load: lateLoad });
    await get(cache, "window", "1", [row(10)]);
    late.resolve("1");
    expect(await older).toEqual([row(10)]);
    expect(lateLoad).not.toHaveBeenCalled();
    expect(cache.stats().pending).toBe(0);
  });

  it("an older lookup can join a later in-flight fill for the exact revision", async () => {
    const cache = createGlHistoryCache(canCache);
    const late = deferred<string>();
    const lateLoad = vi.fn(async () => [row(999)]);
    const older = cache.get("window", { readRevision: () => late.promise, load: lateLoad });
    const current = blockedLoad();
    const newer = cache.get("window", { readRevision: async () => "2", load: current.load });
    await current.started.promise;
    late.resolve("2");
    current.result.resolve([row(2)]);
    expect(await older).toEqual([row(2)]);
    expect(await newer).toEqual([row(2)]);
    expect(lateLoad).not.toHaveBeenCalled();
    expect(current.load).toHaveBeenCalledTimes(1);
    expect(cache.stats().pending).toBe(0);
  });

  it("a late older lookup cannot replace or clear a newer in-flight fill with a different revision", async () => {
    const cache = createGlHistoryCache(canCache);
    const late = deferred<string>();
    const older = cache.get("window", {
      readRevision: () => late.promise, verifyRevision: async () => "1", load: async () => [row(1)],
    });
    const current = blockedLoad();
    const inputs = { readRevision: async () => "2", load: current.load };
    const newer = cache.get("window", inputs);
    await current.started.promise;
    late.resolve("1");
    expect(await older).toEqual([row(1)]);
    expect(cache.stats().pending).toBe(1);
    const joined = cache.get("window", inputs);
    current.result.resolve([row(2)]);
    expect(await newer).toEqual([row(2)]);
    expect(await joined).toEqual([row(2)]);
    expect(current.load).toHaveBeenCalledTimes(1);
    const hit = source("2", [row(999)]);
    expect(await cache.get("window", hit)).toEqual([row(2)]);
    expect(hit.load).not.toHaveBeenCalled();
  });

  it("does not retain a later request's older token when a commit occurs before its fill completes", async () => {
    const cache = createGlHistoryCache(canCache);
    const firstRevision = deferred<string>();
    const first = cache.get("window", {
      readRevision: () => firstRevision.promise,
      verifyRevision: async () => "2",
      load: async () => [row(2)],
    });
    // This request has a newer admission ticket but reads token 1 before
    // the commit. The earlier request's slower lookup then observes token 2.
    const laterFill = blockedLoad();
    const verifyLater = vi.fn(async () => "2");
    const later = cache.get("window", {
      readRevision: async () => "1", verifyRevision: verifyLater, load: laterFill.load,
    });
    await laterFill.started.promise;
    firstRevision.resolve("2");
    expect(await first).toEqual([row(2)]);
    expect(cache.stats().entries).toBe(0);
    laterFill.result.resolve([row(1)]);
    expect(await later).toEqual([row(1)]);
    expect(verifyLater).toHaveBeenCalledTimes(1);
    expect(laterFill.load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    const current = source("2", [row(2)]);
    expect(await cache.get("window", current)).toEqual([row(2)]);
    expect(current.load).toHaveBeenCalledTimes(1);
    expect(cache.stats().entries).toBe(1);
  });

  it("returns the computed snapshot uncached without retry if the source revision changes during the query", async () => {
    const cache = createGlHistoryCache(canCache);
    const initial = [row(4000)];
    const inputs = {
      readRevision: vi.fn(async () => "1"),
      verifyRevision: vi.fn(async () => "2"),
      load: vi.fn(async () => initial),
    };
    const result = await cache.get("window", inputs);
    expect(result).toEqual(initial);
    expect(result).not.toBe(initial);
    expect(result[0]).not.toBe(initial[0]);
    expect(inputs.load).toHaveBeenCalledTimes(1);
    expect(inputs.readRevision).toHaveBeenCalledTimes(1);
    expect(inputs.verifyRevision).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    const retry = source("2", [row(0)]);
    await cache.get("window", retry);
    expect(retry.load).toHaveBeenCalledTimes(1);
  });

  it("defaults post-query verification to a fresh call of readRevision", async () => {
    const cache = createGlHistoryCache(canCache);
    const inputs = {
      readRevision: vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("2"),
      load: vi.fn(async () => [row(4000)]),
    };
    expect(await cache.get("window", inputs)).toEqual([row(4000)]);
    expect(inputs.readRevision).toHaveBeenCalledTimes(2);
    expect(inputs.load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  });
});

describe("historical G/L cache failure cleanup", () => {
  it("fails closed if the current revision cannot be read, even with a retained value", async () => {
    const cache = createGlHistoryCache(canCache);
    await get(cache, "window", "1", [row(1)]);
    const inputs = { readRevision: vi.fn(async () => { throw new Error("revision failed"); }), load: vi.fn(async () => [row(2)]) };
    await expect(cache.get("window", inputs)).rejects.toThrow("revision failed");
    expect(inputs.load).not.toHaveBeenCalled();
    expect(cache.stats().pending).toBe(0);
    expect(await get(cache, "window", "2", [row(2)])).toEqual([row(2)]);
  });

  it.each(["load", "verify", "canCache"] as const)("propagates %s failure without stale fallback, releases the slot, and permits retry", async phase => {
    const cache = createGlHistoryCache(rows => {
      if (phase === "canCache" && rows[0]?.gl === 2) throw new Error("canCache failed");
      return canCache(rows);
    });
    await get(cache, "window", "1", [row(1)]);
    const inputs = {
      readRevision: vi.fn(async () => "2"),
      verifyRevision: vi.fn(async () => {
        if (phase === "verify") throw new Error("verify failed");
        return "2";
      }),
      load: vi.fn(async () => [row(2)]),
    };
    if (phase === "load") inputs.load.mockRejectedValueOnce(new Error("load failed"));
    await expect(cache.get("window", inputs)).rejects.toThrow(`${phase} failed`);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    const retry = source("3", [row(3)]);
    expect(await cache.get("window", retry)).toEqual([row(3)]);
    expect(retry.load).toHaveBeenCalledTimes(1);
  });

  it("shares a fill failure with waiters and releases the slot for the next request", async () => {
    const cache = createGlHistoryCache(canCache);
    const fill = blockedLoad();
    const inputs = { readRevision: async () => "1", load: fill.load };
    const first = cache.get("window", inputs);
    await fill.started.promise;
    const second = cache.get("window", inputs);
    const results = Promise.allSettled([first, second]);
    fill.result.reject(new Error("query failed"));
    expect(await results).toEqual([
      { status: "rejected", reason: new Error("query failed") },
      { status: "rejected", reason: new Error("query failed") },
    ]);
    expect(fill.load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
    expect(await get(cache, "window", "1", [row(2)])).toEqual([row(2)]);
  });

  it("cleans up synchronous loader and revision exceptions", async () => {
    const cache = createGlHistoryCache(canCache);
    await expect(cache.get("read", {
      readRevision: () => { throw new Error("sync revision"); }, load: async () => [row()],
    })).rejects.toThrow("sync revision");
    await expect(cache.get("load", {
      readRevision: async () => "1", load: () => { throw new Error("sync query"); },
    })).rejects.toThrow("sync query");
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  });
});

describe("historical G/L cache retention bounds", () => {
  it("counts UTF-8 bytes of keys, revisions, and serialized rows, and reports counts only", async () => {
    const cache = createGlHistoryCache(canCache);
    const rows = [row(0, { nama: "燃料 ⛽" })];
    await get(cache, "窓:一", "révision:二", rows);
    const expected = retainedBytes("窓:一", "révision:二", rows);
    expect(expected).toBeGreaterThan("窓:一révision:二".length + JSON.stringify(rows).length);
    expect(cache.stats()).toEqual({ entries: 1, bytes: expected, pending: 0 });
    await get(cache, "窓:一", "3", [row(10)]);
    expect(cache.stats()).toEqual({ entries: 1, bytes: retainedBytes("窓:一", "3", [row(10)]), pending: 0 });
  });

  it("evicts least recently used entries at the count cap and updates recency on hits", async () => {
    const cache = createGlHistoryCache(canCache, { maxEntries: 2 });
    const a = source("1", [row(1)]);
    const b = source("1", [row(2)]);
    await cache.get("a", a);
    await cache.get("b", b);
    await cache.get("a", a);
    await get(cache, "c", "1", [row(3)]);
    expect(cache.stats().entries).toBe(2);
    await cache.get("a", a);
    expect(a.load).toHaveBeenCalledTimes(1);
    await cache.get("b", b);
    expect(b.load).toHaveBeenCalledTimes(2);
    expect(cache.stats().entries).toBe(2);
  });

  it("evicts least recently used entries to honor the total byte budget", async () => {
    const size = retainedBytes("a", "1", [row()]);
    const cache = createGlHistoryCache(canCache, { maxEntries: 10, maxBytes: size * 2 });
    const a = source("1");
    const b = source("1");
    await cache.get("a", a);
    await cache.get("b", b);
    expect(cache.stats().bytes).toBe(size * 2);
    await cache.get("a", a);
    await get(cache, "c", "1");
    expect(cache.stats()).toEqual({ entries: 2, bytes: size * 2, pending: 0 });
    await cache.get("a", a);
    expect(a.load).toHaveBeenCalledTimes(1);
    await cache.get("b", b);
    expect(b.load).toHaveBeenCalledTimes(2);
    expect(cache.stats().bytes).toBeLessThanOrEqual(size * 2);
  });

  it.each(["entry", "total"] as const)("returns values exceeding the %s byte budget without retaining or evicting useful entries", async cap => {
    const small = [row()];
    const size = retainedBytes("small", "1", small);
    const cache = createGlHistoryCache(canCache, cap === "entry"
      ? { maxEntryBytes: size, maxBytes: size * 10 }
      : { maxEntryBytes: size * 10, maxBytes: size });
    await get(cache, "small", "1", small);
    const large = source("1", [row(0, { nama: "x".repeat(size * 2) })]);
    const result = await cache.get("large", large);
    expect(result).toEqual(await large.load.mock.results[0]!.value);
    expect(cache.stats()).toEqual({ entries: 1, bytes: size, pending: 0 });
    await cache.get("large", large);
    expect(large.load).toHaveBeenCalledTimes(2);
    const existing = source("1", [row(999)]);
    expect(await cache.get("small", existing)).toEqual(small);
    expect(existing.load).not.toHaveBeenCalled();
  });

  it("admits an entry exactly at its byte cap and rejects one byte above it", async () => {
    const rows = [row()];
    const size = retainedBytes("a", "1", rows);
    const cache = createGlHistoryCache(canCache, { maxEntryBytes: size, maxBytes: size * 3 });
    await get(cache, "a", "1", rows);
    const tooLarge = source("1", rows);
    await cache.get("bb", tooLarge);
    await cache.get("bb", tooLarge);
    expect(tooLarge.load).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toEqual({ entries: 1, bytes: size, pending: 0 });
  });

  it("synchronously refreshes at the TTL boundary instead of serving stale data", async () => {
    let now = 0;
    const cache = createGlHistoryCache(canCache, { ttlMs: 10, now: () => now });
    const inputs = source("1", [row(1)]);
    await cache.get("window", inputs);
    now = 9;
    expect(await cache.get("window", inputs)).toEqual([row(1)]);
    expect(inputs.load).toHaveBeenCalledTimes(1);
    now = 10;
    const refresh = blockedLoad();
    let returned = false;
    const pending = cache.get("window", { readRevision: async () => "1", load: refresh.load })
      .then(rows => { returned = true; return rows; });
    await refresh.started.promise;
    expect(returned).toBe(false);
    expect(cache.stats().entries).toBe(0);
    refresh.result.resolve([row(2)]);
    expect(await pending).toEqual([row(2)]);
    expect(cache.stats().pending).toBe(0);
  });

  it("sweeps expired unrelated keys on get and keeps byte accounting exact", async () => {
    let now = 0;
    const cache = createGlHistoryCache(canCache, { ttlMs: 10, now: () => now });
    await get(cache, "a", "1", [row(1)]);
    now = 5;
    await get(cache, "b", "1", [row(2)]);
    now = 10;
    await get(cache, "c", "1", [row(3)]);
    expect(cache.stats()).toEqual({
      entries: 2, bytes: retainedBytes("b", "1", [row(2)]) + retainedBytes("c", "1", [row(3)]), pending: 0,
    });
    now = 15;
    await get(cache, "c", "1", [row(999)]);
    expect(cache.stats()).toEqual({ entries: 1, bytes: retainedBytes("c", "1", [row(3)]), pending: 0 });
  });

  it("never falls back to expired rows when refresh fails", async () => {
    let now = 0;
    const cache = createGlHistoryCache(canCache, { ttlMs: 10, now: () => now });
    await get(cache, "window", "1", [row(1)]);
    now = 10;
    await expect(cache.get("window", {
      readRevision: async () => "1", load: async () => { throw new Error("refresh failed"); },
    })).rejects.toThrow("refresh failed");
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  });

  it("uses a 24-hour default TTL without extending it on hits", async () => {
    let now = 0;
    const cache = createGlHistoryCache(canCache, { now: () => now });
    const inputs = source("1", [row(1)]);
    await cache.get("window", inputs);
    now = 86_400_000 - 1;
    await cache.get("window", inputs);
    expect(inputs.load).toHaveBeenCalledTimes(1);
    now = 86_400_000;
    await cache.get("window", inputs);
    expect(inputs.load).toHaveBeenCalledTimes(2);
  });

  it("uses a 256-entry default limit", async () => {
    const cache = createGlHistoryCache(canCache);
    const oldest = source("1");
    await cache.get("0", oldest);
    for (let i = 1; i <= 256; i++) await get(cache, String(i), "1");
    expect(cache.stats().entries).toBe(256);
    await cache.get("0", oldest);
    expect(oldest.load).toHaveBeenCalledTimes(2);
    expect(cache.stats().entries).toBe(256);
  });

  it("uses a 2 MiB default per-entry limit", async () => {
    const cache = createGlHistoryCache(canCache);
    const inputs = source("1", [row(0, { nama: "x".repeat(2 * 1024 * 1024) })]);
    await cache.get("window", inputs);
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  });

  it("uses a 16 MiB default total budget", async () => {
    const cache = createGlHistoryCache(canCache);
    const rows = [row(0, { nama: "x".repeat(1_900_000) })];
    for (let i = 0; i < 9; i++) await get(cache, String(i), "1", rows);
    expect(cache.stats().entries).toBe(8);
    expect(cache.stats().bytes).toBe(retainedBytes("0", "1", rows) * 8);
    expect(cache.stats().bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});

describe("historical G/L cache pending registry bounds", () => {
  it("caps unique pending keys before revision reads and bypasses excess requests without retention", async () => {
    const cache = createGlHistoryCache(canCache, { maxPending: 2 });
    const revisions = [deferred<string>(), deferred<string>()];
    const admitted = revisions.map((revision, index) => cache.get(String(index), {
      readRevision: () => revision.promise, verifyRevision: async () => "1", load: async () => [row(index)],
    }));
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 2 });
    const original = [row(3)];
    const excess = { ...source("1", original), verifyRevision: vi.fn(async () => "1") };
    const result = await cache.get("excess", excess);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
    expect(excess.load).toHaveBeenCalledTimes(1);
    expect(excess.readRevision).not.toHaveBeenCalled();
    expect(excess.verifyRevision).not.toHaveBeenCalled();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 2 });
    revisions.forEach(revision => revision.resolve("1"));
    await Promise.all(admitted);
    expect(cache.stats().pending).toBe(0);
    expect(cache.stats().entries).toBe(2);
    await cache.get("excess", excess);
    expect(excess.load).toHaveBeenCalledTimes(2);
    expect(cache.stats().entries).toBe(3);
  });

  it("keeps same-key coalescing available at the pending limit", async () => {
    const cache = createGlHistoryCache(canCache, { maxPending: 1 });
    const fill = blockedLoad();
    const inputs = { readRevision: async () => "1", load: fill.load };
    const first = cache.get("window", inputs);
    await fill.started.promise;
    const second = cache.get("window", inputs);
    expect(cache.stats().pending).toBe(1);
    const excess = source("1", [row(9)]);
    expect(await cache.get("other", excess)).toEqual([row(9)]);
    expect(cache.stats().pending).toBe(1);
    fill.result.resolve([row(1)]);
    expect(await first).toEqual([row(1)]);
    expect(await second).toEqual([row(1)]);
    expect(fill.load).toHaveBeenCalledTimes(1);
    expect(cache.stats().entries).toBe(1);
  });

  it("cleans up a rejected excess request without touching admitted work", async () => {
    const cache = createGlHistoryCache(canCache, { maxPending: 1 });
    const revision = deferred<string>();
    const admitted = cache.get("admitted", { readRevision: () => revision.promise, load: async () => [row(1)] });
    await expect(cache.get("excess", {
      readRevision: async () => "1", load: async () => { throw new Error("bypass failed"); },
    })).rejects.toThrow("bypass failed");
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 1 });
    revision.resolve("1");
    await admitted;
    expect(cache.stats().pending).toBe(0);
    expect(cache.stats().entries).toBe(1);
  });

  it("uses a 32-key default pending limit", async () => {
    const cache = createGlHistoryCache(canCache);
    const revision = deferred<string>();
    const admitted = Array.from({ length: 32 }, (_, i) => cache.get(String(i), {
      readRevision: () => revision.promise, load: async () => [row(i)],
    }));
    expect(cache.stats().pending).toBe(32);
    const excess = source("1", [row(99)]);
    expect(await cache.get("33", excess)).toEqual([row(99)]);
    expect(excess.readRevision).not.toHaveBeenCalled();
    expect(cache.stats().pending).toBe(32);
    expect(cache.stats().entries).toBe(0);
    revision.resolve("1");
    await Promise.all(admitted);
    expect(cache.stats().pending).toBe(0);
    expect(cache.stats().entries).toBe(32);
  });
});
