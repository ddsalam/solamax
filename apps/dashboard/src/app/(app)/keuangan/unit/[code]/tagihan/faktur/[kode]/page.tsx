import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TagihanFakturView } from "@/components/keuangan/TagihanFakturView";
import { unitDotted } from "@/lib/config";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";
import { getTagihanFaktur, getTanggalSaldoPelanggan } from "@/lib/tagihan-queries";
import { parseKodeFaktur, tagihanListHref, tagihanPelangganHref } from "@/lib/tagihan-route";

export const dynamic = "force-dynamic";

/**
 * S2 Rincian faktur (rencana 2026-11-13 U8). Kode tak dikenal, faktur milik
 * unit lain, dan unit yang belum punya siklus tagihan lengkap semuanya 404 —
 * `getTagihanFaktur` memulangkan `null` untuk ketiganya.
 */
export default async function TagihanFakturPage({
  params,
}: {
  params: Promise<{ code: string; kode: string }>;
}) {
  const { code, kode } = await params;
  const kodeFaktur = parseKodeFaktur(kode);
  if (kodeFaktur === null) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const hariIni = todayWib();
  const rinci = await getTagihanFaktur(unit.unit_id, kodeFaktur, hariIni);
  if (rinci === null) notFound();

  // Halaman pelanggan hidup di bawah tanggal Saldo pelanggan dan menjawab 404
  // untuk pelanggan yang tak punya baris di snapshot tanggal itu. Tautannya
  // karena itu hanya dibuat bila pelanggan faktur ini ADA di snapshot terbit
  // terakhir; kode kosong, unit tanpa snapshot terbit, atau pelanggan yang
  // belum masuk snapshot → `null`, dan nama/kodenya tampil sebagai teks biasa.
  const tanggalSaldo = await getTanggalSaldoPelanggan(unit.unit_id, rinci.faktur.customerCode);

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-tagihan"
      />
      <TagihanFakturView
        unit={{ code: unit.code, name: unit.name }}
        rinci={rinci}
        daftarHref={tagihanListHref(unit.code)}
        pelangganHref={
          tanggalSaldo === null ? null : tagihanPelangganHref(unit.code, tanggalSaldo, rinci.faktur.customerCode)
        }
      />
    </>
  );
}
