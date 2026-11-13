import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TagihanView } from "@/components/keuangan/TagihanView";
import { unitDotted } from "@/lib/config";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";
import { getBelumDitagihkan, getDokumenBelumDitagihkan, getTagihanDaftar } from "@/lib/tagihan-queries";
import { isTampilanFaktur, normalizeTagihanView, tagihanViewInput } from "@/lib/tagihan-route";

export const dynamic = "force-dynamic";

/**
 * S1 Daftar tagihan per SPBU + S3 Belum ditagihkan (rencana 2026-11-13 U7).
 * Tanpa dimensi tanggal: status dihitung terhadap HARI INI (WIB) pada setiap
 * muat halaman — tidak ada yang disimpan (KTD4).
 */
export default async function TagihanPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, rawQuery] = await Promise.all([params, searchParams]);

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const hariIni = todayWib();
  // Nilai URL tak dikenal jatuh ke bawaan ("Perlu tindakan"), sama seperti layar saldo.
  const view = normalizeTagihanView(tagihanViewInput(rawQuery), hariIni);
  const umum = { unit: { code: unit.code, name: unit.name }, view, hariIni };

  let isi;
  if (isTampilanFaktur(view.tampilan)) {
    const data = await getTagihanDaftar(unit.unit_id, {
      filter: view.tampilan,
      cari: view.search,
      halaman: view.page,
      periodeLunas: view.periode,
      hariIni,
    });
    isi = data.tersedia
      ? <TagihanView {...umum} state="faktur" data={data} />
      : <TagihanView {...umum} state="belum_tersedia" />;
  } else {
    const data = await getBelumDitagihkan(unit.unit_id, { cari: view.search, hariIni });
    if (!data.tersedia) {
      isi = <TagihanView {...umum} state="belum_tersedia" />;
    } else {
      // Dokumen hanya ditarik untuk kelompok yang memang ada di daftar ini:
      // `buka` dari URL yang tak cocok dengan kelompok mana pun diabaikan.
      const dibuka = data.kelompok.find((k) => k.customerCode === view.buka);
      const dokumenBuka = dibuka
        ? await getDokumenBelumDitagihkan(unit.unit_id, dibuka.customerCode)
        : null;
      isi = <TagihanView {...umum} state="belum_ditagihkan" data={data} dokumenBuka={dokumenBuka} />;
    }
  }

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-tagihan"
      />
      {isi}
    </>
  );
}
