import { describe, expect, it } from "vitest";
import { belumTerpasang } from "./tunggu-migrasi.mjs";

// Baris `_prisma_migrations` sebagaimana dibaca skrip.
const selesai = (migration_name) => ({ migration_name, finished_at: new Date(), rolled_back_at: null });

describe("belumTerpasang — migrasi commit ini yang belum ada di DB", () => {
  it("kosong bila semua migrasi commit sudah selesai di DB", () => {
    expect(belumTerpasang(["0059_a", "0060_b"], [selesai("0059_a"), selesai("0060_b")])).toEqual([]);
  });

  it("menyebut migrasi yang belum punya baris (kasus 7 Nov: 0060 belum dijalankan backend)", () => {
    expect(belumTerpasang(["0059_a", "0060_b"], [selesai("0059_a")])).toEqual(["0060_b"]);
  });

  it("baris yang belum selesai (sedang jalan / gagal P3009) dihitung BELUM terpasang", () => {
    const sedangJalan = { migration_name: "0060_b", finished_at: null, rolled_back_at: null };
    expect(belumTerpasang(["0060_b"], [sedangJalan])).toEqual(["0060_b"]);
  });

  it("baris yang di-rollback dihitung belum terpasang, kecuali ada baris selesai sesudahnya", () => {
    const rolledBack = { migration_name: "0060_b", finished_at: null, rolled_back_at: new Date() };
    expect(belumTerpasang(["0060_b"], [rolledBack])).toEqual(["0060_b"]);
    expect(belumTerpasang(["0060_b"], [rolledBack, selesai("0060_b")])).toEqual([]);
  });

  it("migrasi DB yang tidak ada di commit (DB lebih maju) tidak menahan", () => {
    expect(belumTerpasang(["0059_a"], [selesai("0059_a"), selesai("0061_c")])).toEqual([]);
  });
});
