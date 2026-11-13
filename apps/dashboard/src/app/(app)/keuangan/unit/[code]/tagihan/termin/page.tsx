import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TerminPanel } from "@/components/keuangan/TerminPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import { canAturTermin, canViewLaporanKeuangan, pesanTakBolehAturTermin } from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";
import { TAGIHAN_BELUM_TERSEDIA, getTagihanRingkasanUnit } from "@/lib/tagihan-queries";
import { tagihanKesegaranLabel, tagihanListHref, tagihanRingkasanHref, tagihanTerminHref } from "@/lib/tagihan-route";
import { getPelangganUntukTermin, getTerminUnit, pelangganTerminBawaan } from "@/lib/termin-queries";
import { TERMIN_HARI_MAKS, TERMIN_HARI_MIN } from "@/lib/termin-tulis";

export const dynamic = "force-dynamic";

/**
 * S4 — Atur termin pembayaran per unit (rencana 2026-11-13 U9; R14–R16, F2).
 * Keputusan yang mengikat: `apps/dashboard/PIUTANG-PELANGGAN.md` §4.
 *
 * Wewenang dihitung DI SERVER, satu predikat per hal:
 *   · baca  → `canViewLaporanKeuangan` (sama dengan seluruh modul Keuangan)
 *   · ubah  → `canAturTermin` (staf Keuangan, Head of Finance, super admin)
 * Pembaca tanpa `canAturTermin` melihat semuanya tanpa kolom isian; gerbang
 * tulisnya tetap di server action (`termin-actions.ts`).
 *
 * Daftar pelanggan BAWAAN = pelanggan yang bisa punya piutang (kelas 1 atau 5
 * dengan kode tanpa titik, atau kode bertitik — populasi yang sama dengan
 * "belum ditagihkan") ditambah setiap pelanggan yang sudah punya pengecualian,
 * berapa pun kelasnya dan walau sudah lenyap dari master. Pelanggan kelas
 * penjualan tunai tak pernah punya faktur, jadi tak perlu termin; `?semua=1`
 * menampilkan seluruh master bagi yang tetap ingin mengaturnya.
 *
 * Catatan "N faktur bergantung pada termin SolaMax" hanya tampil bila unit
 * sudah punya satu siklus tagihan lengkap (KTD11); master termin sendiri tak
 * menunggu itu — Finance boleh mengisinya sebelum agent unit ditukar. Catatan
 * itu dihitung TANPA memindai buku piutang (`tanpaBelumDitagihkan`): layar ini
 * tak menampilkan "belum ditagihkan".
 */
export default async function AturTerminPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ q?: string | string[]; semua?: string | string[] }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const [terminUnit, semuaPelanggan, ringkasan] = await Promise.all([
    getTerminUnit(unit.unit_id),
    getPelangganUntukTermin(unit.unit_id),
    getTagihanRingkasanUnit(unit.unit_id, undefined, { tanpaBelumDitagihkan: true }),
  ]);
  const cariAwal = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const tampilSemua = (Array.isArray(sp.semua) ? sp.semua[0] : sp.semua) === "1";
  const pelanggan = tampilSemua ? semuaPelanggan : pelangganTerminBawaan(semuaPelanggan);

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-tagihan"
      />
      <div className="section-h">
        <h1 className="text-h3 t-brand">Atur termin pembayaran</h1>
        <Link className="btn-outline sm" href={tagihanListHref(unit.code)}>
          ← Tagihan pelanggan
        </Link>
        <Link className="btn-outline sm" href={tagihanRingkasanHref()}>
          Ringkasan semua SPBU
        </Link>
      </div>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Jatuh tempo faktur diambil dari EasyMax bila diisi dengan sah. Bila tidak, jatuh tempo = tanggal
        faktur + termin di halaman ini: pengecualian pelanggan bila ada, selain itu termin bawaan unit.
      </p>

      {ringkasan.tersedia ? (
        <div className="banner info keu-banner" role="status" data-termin-bergantung>
          <b>
            {ringkasan.fakturBergantungTermin.toLocaleString("id-ID")} faktur terbuka saat ini bergantung pada
            termin SolaMax
          </b>
          <p className="keu-p">
            {ringkasan.ubin.terminBelumDiatur.jumlah > 0
              ? `${ringkasan.ubin.terminBelumDiatur.jumlah.toLocaleString("id-ID")} di antaranya masih “Termin belum diatur” dan belum dihitung lewat jatuh tempo. `
              : ""}
            {tagihanKesegaranLabel(ringkasan.kesiapan.selesaiAt)}.
          </p>
          {ringkasan.terpotong && (
            <p className="keu-p t-danger">Jumlah faktur melampaui batas baca — angka di atas tidak lengkap.</p>
          )}
        </div>
      ) : (
        <div className="banner warning keu-banner" role="status" data-termin-belum-tersedia>
          <b>{TAGIHAN_BELUM_TERSEDIA}</b>
          <p className="keu-p">
            Termin tetap bisa diatur sekarang; ia mulai dipakai begitu data tagihan unit ini masuk.
          </p>
        </div>
      )}

      <TerminPanel
        code={unit.code}
        namaUnit={unit.name}
        terminUnit={terminUnit}
        pelanggan={pelanggan}
        bolehAtur={canAturTermin(ctx)}
        pesanTakBoleh={pesanTakBolehAturTermin()}
        batas={{ min: TERMIN_HARI_MIN, maks: TERMIN_HARI_MAKS }}
        cariAwal={cariAwal}
        cakupan={{
          semua: tampilSemua,
          jumlahMaster: semuaPelanggan.length,
          hrefSemua: tagihanTerminHref(unit.code, { semua: true, cari: cariAwal }),
          hrefPiutang: tagihanTerminHref(unit.code, { cari: cariAwal }),
        }}
      />
    </>
  );
}
