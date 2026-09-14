/** Migration 0039 is atomic, so this unique column appears only after the
 * complete v2 rebuild commits. Never retry unrelated K1 query failures. */
export const SNAPSHOT_V2_SCHEMA_READY_SQL = `
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'app' AND table_name = 'saldo_pelanggan_snapshot_row'
    AND column_name = 'akhir_hutang_lokal_kredit'
    AND is_nullable = 'NO' AND data_type = 'numeric'
) AS ready`;

/** The backend and dashboard deployment workflows start concurrently. K1 must
 * wait for the backend's atomic upgrade before testing the new reader SQL. */
export async function waitForSnapshotV2Schema(
  readReady: () => Promise<boolean>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? 10 * 60 * 1000);
  for (;;) {
    if (await readReady()) return;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("snapshot_v2_schema_not_ready: backend migration 0039 did not finish before dashboard K1 deadline");
    await sleep(Math.min(options.intervalMs ?? 5000, remaining));
  }
}
