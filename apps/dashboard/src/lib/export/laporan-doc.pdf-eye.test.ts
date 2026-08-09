/**
 * PEMERIKSAAN MATA PDF (di-skip kecuali diminta) — membangun Laporan Operasional
 * Harian LENGKAP dari data LIVE dan menuliskannya sebagai PDF SUNGGUHAN lewat
 * pdfmake, supaya section "Arus Minyak Harian" bisa DILIHAT di berkas akhir:
 * posisinya, urutan kolom, perataan angka, baris TOTAL, dan apakah tabelnya
 * terpotong di batas halaman.
 *
 * `docDefinition` yang benar BUKAN PDF yang benar — itulah alasan berkas ini ada.
 * Dibuat sbg TES (bukan skrip lepas) supaya ikut ter-typecheck & memakai resolver
 * yang sama; tanpa flag ia di-skip dan terlihat di keluaran vitest.
 *
 *   SCOPE_LIVE_DB=1 ARUS_PDF_EYE=1 ARUS_UNIT=6478111 \\
 *   ARUS_DATES=2026-08-02,2026-08-06 pnpm --filter @solamax/dashboard test -- pdf-eye
 *
 * Read-only: hanya SELECT (role `dashboard_ro`).
 *
 * CATATAN JUJUR: `dashboard_ro` sengaja TIDAK punya akses schema `app`, jadi
 * entri manual (rekon F/G/I) di PDF hasil pemeriksaan ini KOSONG. Itu pilihan
 * sadar — memakai `dashboard_app` akan membuat berkas ini "read-only karena
 * disiplin" alih-alih "read-only karena grant". Section Arus Minyak dan kedua
 * tetangganya (Alokasi/DO, Harga) seluruhnya dari schema `public` → tak
 * terpengaruh.
 */
import { writeFileSync } from "node:fs";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildLaporanDocDefinition } from "./laporan-doc";
import { unitDotted } from "@/lib/config";
import { buildLaporanModel } from "@/lib/laporan-model";
import { addDays, monthInfo, monthStart } from "@/lib/periods";

/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

const AKTIF = process.env.SCOPE_LIVE_DB === "1" && process.env.ARUS_PDF_EYE === "1";
const d = AKTIF ? describe : describe.skip;

d("PDF sungguhan dari data live (pemeriksaan mata)", () => {
  it("menulis PDF yang bisa dibuka & dilihat", async () => {
    const Q = await import("@/lib/queries");
    const { pool, q } = await import("@/lib/db");
    type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];

    const code = process.env.ARUS_UNIT ?? "6478111";
    const dates = (process.env.ARUS_DATES ?? "2026-08-02,2026-08-06").split(",").filter(Boolean);
    const [u] = await q<{ unit_id: number; name: string }>(
      `SELECT unit_id, name FROM public.unit WHERE code = $1`,
      [code],
    );
    expect(u, `unit ${code} tak ada`).toBeDefined();
    const unitId = u!.unit_id as SUID;

    /** Entri manual ada di schema `app` yang tak terlihat oleh role read-only. */
    let manualDitolak = false;
    const manual = async (dd: string, kind: string) => {
      try {
        return await Q.getManualEntries(unitId, dd, kind as never);
      } catch {
        manualDitolak = true;
        return [];
      }
    };

    for (const date of dates) {

      const mStart = monthStart(date);
      const today = "2026-08-09";
      const [
        prodDay, glRows, prodMonth, delivMonth, doDay, doAnomalies, doSuspects, shift,
        corrections, cash, saldo, recapPelanggan, recapEdc, recapDeposit,
        recapPendapatanLain, recapPengeluaran, recapSetoran, terra,
        fK, gK, iK, fB, gB, iB,
      ] = await Promise.all([
        Q.getSalesByProduct(unitId, date, date),
        Q.getDailyGlByProduct(unitId, mStart, date),
        Q.getSalesByProduct(unitId, mStart, date),
        Q.getDeliveryByProduct(unitId, mStart, date),
        Q.getDoHarian(unitId, date),
        Q.getDoAnomalies(unitId, date),
        Q.getDoSuspectSO(unitId, date),
        Q.getShiftInfo(unitId, date),
        Q.getCorrections(unitId, date),
        Q.getCashForDate(unitId, date),
        Q.getSaldoPelanggan(unitId, date),
        Q.getPelangganForDate(unitId, date),
        Q.getEdcForDate(unitId, date),
        Q.getDepositForDate(unitId, date),
        manual(date, "pendapatan_lain"),
        manual(date, "pengeluaran"),
        manual(date, "setoran_tunai"),
        Q.getTerraResmiForDate(unitId, date),
        manual(addDays(date, -1), "pendapatan_lain"),
        manual(addDays(date, -1), "pengeluaran"),
        manual(addDays(date, -1), "setoran_tunai"),
        manual(addDays(date, 1), "pendapatan_lain"),
        manual(addDays(date, 1), "pengeluaran"),
        manual(addDays(date, 1), "setoran_tunai"),
      ]);
      const mi = monthInfo(date);
      const model = buildLaporanModel(
        {
          prodDay, glRows, prodMonth, delivMonth, doDay, doAnomalies, doSuspects, shift,
          corrections, cash, saldo, recapPelanggan, recapEdc, recapDeposit,
          recapPendapatanLain, recapPengeluaran, recapSetoran, terra,
          tetanggaSebelum: { f: fK, g: gK, i: iK },
          tetanggaSesudah: { f: fB, g: gB, i: iB },
        } as never,
        { unitCode: code, date, today, mi, detail: true },
      );
      const doc = buildLaporanDocDefinition({
        model,
        meta: {
          unitDotted: unitDotted(code),
          unitName: u!.name,
          dateLong: date,
          monthName: "Agustus",
          dayOfMonth: mi.dayOfMonth,
          daysInMonth: mi.daysInMonth,
          staleDays: Q.DO_STALE_DAYS,
          generatedLabel: `${today} · pemeriksaan mata`,
        },
        config: DEFAULT_EXPORT_CONFIG,
      });
      const out = `/tmp/laporan-${code}-${date}.pdf`;
      await new Promise<void>((res) =>
        pdfMake.createPdf(doc).getBuffer((b: Buffer) => {
          writeFileSync(out, b);
          console.log(`${out}  ${(b.length / 1024).toFixed(0)} KB · baris arus ${model.arusMinyak.rows.length}`);
          res();
        }),
      );
    }
    if (manualDitolak)
      console.log("CATATAN: entri manual (rekon F/G/I) KOSONG — role read-only tak melihat schema app.");
    await pool.end();
  }, 600_000);
});
