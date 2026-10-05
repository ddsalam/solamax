import type { DailyGlRow } from "./queries";

export interface GlHistoryCacheOptions {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
  /** Bound the coalescing registry, not the application's database concurrency. */
  maxPending: number;
  ttlMs: number;
  now: () => number;
}

const DEFAULTS: GlHistoryCacheOptions = {
  maxEntries: 256,
  maxBytes: 16 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,
  maxPending: 32,
  ttlMs: 86_400_000,
  now: Date.now,
};

interface Entry {
  revision: string;
  body: string;
  bytes: number;
  expiresAt: number;
}

interface Flight {
  revision: string;
  promise: Promise<DailyGlRow[]>;
}

interface Slot {
  admitted: bigint;
  readers: number;
  flight?: Flight;
}

interface Loaders {
  readRevision: () => Promise<string>;
  load: () => Promise<DailyGlRow[]>;
  /** Must bypass request memoization so a concurrent commit is observable. */
  verifyRevision?: () => Promise<string>;
}

// DailyGlRow consists only of scalar fields. Each consumer gets its own rows,
// including callers sharing an in-flight query and non-cacheable results.
const copyRows = (rows: readonly DailyGlRow[]): DailyGlRow[] => rows.map((row) => ({ ...row }));

/**
 * Process-local historical G/L cache. Stable unit/window keys hold at most one
 * revision, never one disk file per ingest. Limits count serialized payload,
 * key and revision bytes; they do not claim to bound V8 or active query memory.
 * The registry cap bounds cache-owned pending metadata. Overflow performs the
 * caller's ordinary uncached query; existing page fan-out limits still apply.
 */
export function createGlHistoryCache(
  canCache: (rows: readonly DailyGlRow[]) => boolean,
  options: Partial<GlHistoryCacheOptions> = {},
) {
  const limits = { ...DEFAULTS, ...options };
  for (const name of ["maxEntries", "maxBytes", "maxEntryBytes", "maxPending", "ttlMs"] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) throw new Error("Invalid G/L cache limit");
  }
  const entries = new Map<string, Entry>();
  const slots = new Map<string, Slot>();
  let bytes = 0;
  let ticket = 0n;

  function remove(key: string) {
    const previous = entries.get(key);
    if (previous) bytes -= previous.bytes;
    entries.delete(key);
  }

  function expire() {
    const now = limits.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) remove(key);
  }

  function retain(key: string, entry: Entry) {
    expire();
    remove(key);
    while (entries.size >= limits.maxEntries || bytes + entry.bytes > limits.maxBytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      remove(oldest);
    }
    entries.set(key, entry);
    bytes += entry.bytes;
  }

  async function get(key: string, loaders: Loaders): Promise<DailyGlRow[]> {
    expire();
    let slot = slots.get(key);
    if (!slot) {
      if (slots.size >= limits.maxPending) return copyRows(await loaders.load());
      slot = { admitted: 0n, readers: 0 };
      slots.set(key, slot);
    }
    const activeSlot = slot;
    // Issue this BEFORE the asynchronous revision read. An older slow lookup
    // cannot supersede a later request which has already observed a new token.
    const admission = ++ticket;
    activeSlot.readers++;
    try {
      const revision = await loaders.readRevision();
      if (typeof revision !== "string" || revision.length === 0) throw new Error("Invalid G/L source revision");
      expire();
      const entry = entries.get(key);
      if (entry?.revision === revision) {
        entries.delete(key);
        entries.set(key, entry);
        activeSlot.admitted = admission > activeSlot.admitted ? admission : activeSlot.admitted;
        return JSON.parse(entry.body) as DailyGlRow[];
      }
      if (admission < activeSlot.admitted) {
        const matching = activeSlot.flight?.revision === revision ? activeSlot.flight.promise : loaders.load();
        return copyRows(await matching);
      }
      activeSlot.admitted = admission;
      remove(key);
      if (activeSlot.flight?.revision === revision) return copyRows(await activeSlot.flight.promise);

      const flight: Flight = { revision, promise: Promise.resolve([]) };
      activeSlot.flight = flight;
      flight.promise = (async () => {
        const loadedAt = limits.now();
        const rows = await loaders.load();
        if (!canCache(rows)) return rows;
        const body = JSON.stringify(rows);
        const size = Buffer.byteLength(body) + Buffer.byteLength(key) + Buffer.byteLength(revision);
        if (size > limits.maxEntryBytes || size > limits.maxBytes) return rows;
        const verified = await (loaders.verifyRevision ?? loaders.readRevision)();
        if (verified !== revision) {
          // A commit crossed the query. Return its computed snapshot uncached;
          // this layer does not retry or promise cross-domain atomic reports.
          return rows;
        }
        if (slots.get(key) === activeSlot && activeSlot.flight === flight
          && loadedAt + limits.ttlMs > limits.now()) {
          retain(key, { revision, body, bytes: size, expiresAt: loadedAt + limits.ttlMs });
        }
        return rows;
      })().finally(() => {
        if (activeSlot.flight === flight) activeSlot.flight = undefined;
      });
      return copyRows(await flight.promise);
    } finally {
      activeSlot.readers--;
      if (activeSlot.readers === 0 && slots.get(key) === activeSlot) slots.delete(key);
    }
  }

  return {
    get,
    stats: () => ({ entries: entries.size, bytes, pending: slots.size }),
  };
}
