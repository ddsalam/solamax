import { describe, expect, it } from "vitest";
import {
  assertSelectOnly,
  ReadOnlyViolationError,
} from "./readonly-guard.js";
import { CASH_DOMAIN, DATETIME_DOMAINS, MASTERS_DOMAIN } from "../domains.js";

describe("assertSelectOnly", () => {
  it("mengizinkan SELECT biasa", () => {
    expect(() =>
      assertSelectOnly("SELECT * FROM tr_djualbbm WHERE DTGLJAM > ?"),
    ).not.toThrow();
  });

  it("mengizinkan SHOW / DESCRIBE", () => {
    expect(() => assertSelectOnly("SHOW TABLES")).not.toThrow();
    expect(() => assertSelectOnly("DESCRIBE tr_terimabbm")).not.toThrow();
  });

  it.each([
    "INSERT INTO x VALUES (1)",
    "UPDATE tr_djualbbm SET NVOLUME = 0",
    "DELETE FROM tr_hkasbank",
    "DROP TABLE x",
    "TRUNCATE tr_djualbbm",
    "REPLACE INTO x VALUES (1)",
    "CALL some_proc()",
  ])("menolak write: %s", (sql) => {
    expect(() => assertSelectOnly(sql)).toThrow(ReadOnlyViolationError);
  });

  it("menolak multiple statement (write tersembunyi setelah ;)", () => {
    expect(() =>
      assertSelectOnly("SELECT 1; DELETE FROM tr_djualbbm"),
    ).toThrow(ReadOnlyViolationError);
  });

  it("menolak write yang disembunyikan di komentar lalu disambung", () => {
    expect(() =>
      assertSelectOnly("SELECT 1 /* */ ; UPDATE x SET y=1"),
    ).toThrow(ReadOnlyViolationError);
  });

  it("mengizinkan titik koma trailing tunggal", () => {
    expect(() => assertSelectOnly("SELECT 1;")).not.toThrow();
  });

  it("SEMUA query domain lolos guard (tak akan menulis ke easymax)", () => {
    for (const d of DATETIME_DOMAINS) {
      expect(() => assertSelectOnly(d.sql)).not.toThrow();
    }
    expect(() => assertSelectOnly(CASH_DOMAIN.sql)).not.toThrow();
    for (const q of MASTERS_DOMAIN.queries) {
      expect(() => assertSelectOnly(q.sql)).not.toThrow();
    }
  });
});
