import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_SKIP_CLASSIFICATION,
  SNAPSHOT_UNKNOWN_SKIP,
  classifySkip,
} from "./snapshot-trigger.controller.js";

/**
 * Kelas kegagalan yang dijaga berkas ini: DUA KEADAAN YANG SANGAT BERBEDA
 * DERAJATNYA TERLIHAT SAMA DARI LUAR.
 *
 * 12-14 September 2026 build snapshot beku berhari-hari karena
 * `disk_review_required`, dan tidak seorang pun melihatnya: HTTP-nya 425 —
 * persis sama dengan `outside_build_window`, yang normal terjadi 21 dari 24
 * jam — dan baris lognya hanya memuat `status:"skipped"`.
 *
 * Uji ini harus MERAH bila keduanya kembali tak terbedakan, dan juga bila
 * sebab BARU ditambahkan tanpa diklasifikasikan.
 */

const SOURCES = [
  "snapshot-worker.service.ts",
  "snapshot-builder.service.ts",
] as const;

function reasonsInSource(): string[] {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(resolve(__dirname, file), "utf8");
    for (const match of text.matchAll(/reason: "([a-z_]+)"/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

describe("klasifikasi sebab skip worker snapshot", () => {
  it("MENEMUKAN sebab-sebabnya dari sumber — bukan dari daftar yang disalin tangan", () => {
    // Kontrol atas uji ini sendiri: kalau regexnya berhenti cocok, seluruh
    // pemeriksaan di bawah lulus secara hampa. Jumlahnya harus masuk akal.
    const reasons = reasonsInSource();
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    expect(reasons).toContain("disk_review_required");
    expect(reasons).toContain("outside_build_window");
  });

  it("setiap sebab yang dapat diproduksi kode SUDAH diklasifikasikan", () => {
    const unclassified = reasonsInSource()
      .filter(reason => !(reason in SNAPSHOT_SKIP_CLASSIFICATION));
    // Sebab baru yang lupa didaftarkan akan jatuh ke SNAPSHOT_UNKNOWN_SKIP dan
    // berbunyi keras di produksi. Itu jaring terakhir, bukan rencana — di sini
    // ia tertangkap sebelum sampai ke sana.
    expect(unclassified).toEqual([]);
  });

  it("disk dan jam BERBEDA di HTTP maupun di tingkat insiden", () => {
    const disk = classifySkip("disk_review_required");
    const jam = classifySkip("outside_build_window");
    expect(disk.http).not.toBe(jam.http);
    expect(disk.incident).toBe(true);
    expect(jam.incident).toBe(false);
    // 425 dipertahankan untuk yang normal supaya arti lamanya tidak bergeser;
    // yang berubah hanya yang berbahaya.
    expect(jam.http).toBe(425);
    expect(disk.http).toBe(507);
  });

  it("setiap sebab INSIDEN memakai status HTTP yang tak dipakai sebab normal", () => {
    const normal = new Set(
      Object.values(SNAPSHOT_SKIP_CLASSIFICATION).filter(c => !c.incident).map(c => c.http));
    const insiden = Object.entries(SNAPSHOT_SKIP_CLASSIFICATION).filter(([, c]) => c.incident);
    expect(insiden.length).toBeGreaterThan(0);
    for (const [reason, c] of insiden) {
      expect(normal.has(c.http), `${reason} berbagi status HTTP dengan skip normal`).toBe(false);
    }
  });

  it("sebab yang TIDAK dikenal diperlakukan sebagai insiden, bukan normal", () => {
    const unknown = classifySkip("sebab_yang_belum_pernah_ada");
    expect(unknown).toBe(SNAPSHOT_UNKNOWN_SKIP);
    expect(unknown.incident).toBe(true);
    expect(unknown.http).not.toBe(425);
  });
});
