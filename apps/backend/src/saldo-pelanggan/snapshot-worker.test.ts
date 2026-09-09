import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_WORK_SQL,
  LEASE_WORK_SQL,
  REAP_EXPIRED_WORK_SQL,
  RETRY_WORK_SQL,
} from "./snapshot-worker-sql.js";
import { retryDelaySeconds } from "./snapshot-worker.service.js";

describe("snapshot worker durable queue", () => {
  it("uses the accepted capped exponential backoff with 0-25% jitter", () => {
    expect(retryDelaySeconds(1, 0)).toBe(30);
    expect(retryDelaySeconds(2, 0)).toBe(60);
    expect(retryDelaySeconds(5, 0)).toBe(480);
    expect(retryDelaySeconds(6, 0)).toBe(900);
    expect(retryDelaySeconds(1, 0.25)).toBe(38);
    expect(() => retryDelaySeconds(0, 0)).toThrow();
    expect(() => retryDelaySeconds(1, 0.26)).toThrow();
  });

  it("leases only one exact-unit item inside the fixed WIB/disk gates", () => {
    expect(LEASE_WORK_SQL).toContain("FOR UPDATE OF w SKIP LOCKED");
    expect(LEASE_WORK_SQL).toContain("unit_id = $1::smallint");
    expect(LEASE_WORK_SQL).toContain("Asia/Pontianak");
    expect(LEASE_WORK_SQL).toContain("< 285");
    expect(LEASE_WORK_SQL).toContain("pg_database_size(current_database()) < 9000000000");
    expect(LEASE_WORK_SQL).toContain("state = 'leased'");
    expect(LEASE_WORK_SQL).toContain("attempt_count = attempt_count + 1");
  });

  it("heartbeats and recovers only the matching owner lease", () => {
    expect(HEARTBEAT_WORK_SQL).toContain("lease_owner = $3::text");
    expect(HEARTBEAT_WORK_SQL).toContain("state = 'leased'");
    expect(REAP_EXPIRED_WORK_SQL).toContain("lease_expires_at < clock_timestamp()");
    expect(RETRY_WORK_SQL).toContain("dead_letter");
    expect(RETRY_WORK_SQL).toContain("retry_wait");
    expect(RETRY_WORK_SQL).toContain("attempt_count >= 5");
  });
});
