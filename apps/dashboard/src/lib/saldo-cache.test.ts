import { describe, expect, it, vi } from "vitest";

// saldo-cache → queries → db (pool eager) — test murni tak butuh DB.
vi.mock("./db", () => ({ q: vi.fn(), qScoped: vi.fn(), pool: {} }));

import {
  SALDO_HIST_REVALIDATE_S,
  SALDO_LIVE_REVALIDATE_S,
  resolveSaldo,
  saldoRevalidateSeconds,
  shouldBypassEmptySaldo,
} from "./saldo-cache";

const S = (a: number, b: number, c: number) => ({
  piutangLokal: a,
  piutangOnline: b,
  hutangLokal: c,
});

describe("cakupan cache saldo", () => {
  const today = "2026-08-05";

  it("historis (≤ hari-ini − 2) diawetkan 24 jam", () => {
    expect(saldoRevalidateSeconds("2026-08-03", today)).toBe(SALDO_HIST_REVALIDATE_S);
    expect(saldoRevalidateSeconds("2012-07-31", today)).toBe(SALDO_HIST_REVALIDATE_S);
  });

  it("hari berjalan & H−1 memakai TTL pendek, BUKAN 24 jam", () => {
    // Inilah pagarnya: 24 jam di sini = saldo hari ini basi sehari penuh di
    // laporan operasional — regresi KOREKTNESS, bukan sekadar angka lawas.
    expect(saldoRevalidateSeconds(today, today)).toBe(SALDO_LIVE_REVALIDATE_S);
    expect(saldoRevalidateSeconds("2026-08-04", today)).toBe(SALDO_LIVE_REVALIDATE_S);
  });

  it("batasnya tepat di H−2, tidak bergeser satu hari", () => {
    expect(saldoRevalidateSeconds("2026-08-03", today)).toBe(SALDO_HIST_REVALIDATE_S);
    expect(saldoRevalidateSeconds("2026-08-04", today)).toBe(SALDO_LIVE_REVALIDATE_S);
  });

  it("TTL hari berjalan tetap jauh di bawah awetan historis", () => {
    // Menaikkannya ke 15 menit sah; menyamakannya dengan 24 jam tidak.
    expect(SALDO_LIVE_REVALIDATE_S).toBeLessThan(SALDO_HIST_REVALIDATE_S / 10);
    // Dan harus lebih panjang dari biaya mengisinya — sesudah reclaim query itu
    // 1,47 dtk, jadi 120 dtk kembali memenuhi syarat yang sama.
    expect(SALDO_LIVE_REVALIDATE_S).toBeGreaterThan(60);
  });

  it("tanggal masa depan tidak pernah diperlakukan historis", () => {
    expect(saldoRevalidateSeconds("2026-08-09", today)).toBe(SALDO_LIVE_REVALIDATE_S);
  });
});

describe("jebakan nol-semua (kembaran D13 gl-window)", () => {
  it("nol-semua dianggap tak layak cache", () => {
    expect(shouldBypassEmptySaldo(S(0, 0, 0))).toBe(true);
  });

  it("satu komponen tak nol sudah cukup untuk dipercaya", () => {
    expect(shouldBypassEmptySaldo(S(1, 0, 0))).toBe(false);
    expect(shouldBypassEmptySaldo(S(0, -5, 0))).toBe(false);
    expect(shouldBypassEmptySaldo(S(0, 0, -1))).toBe(false);
  });

  it("cache hit non-nol dipakai apa adanya — `fresh` tak pernah dipanggil", async () => {
    let freshCalls = 0;
    const out = await resolveSaldo(
      () => Promise.resolve(S(10, 20, -30)),
      () => {
        freshCalls += 1;
        return Promise.resolve(S(0, 0, 0));
      },
    );
    expect(out).toEqual(S(10, 20, -30));
    expect(freshCalls).toBe(0);
  });

  it("cache hit nol-semua DIABAIKAN dan query diulang segar", async () => {
    let freshCalls = 0;
    const out = await resolveSaldo(
      () => Promise.resolve(S(0, 0, 0)),
      () => {
        freshCalls += 1;
        return Promise.resolve(S(7, 8, 9));
      },
    );
    expect(out).toEqual(S(7, 8, 9));
    expect(freshCalls).toBe(1);
  });
});
