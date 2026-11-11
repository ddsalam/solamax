import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { KoreksiTransferPanel } from "@/components/keuangan/KoreksiTransferPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import { canJadikanTransfer, canJadikanTransferHariTutup, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";
import { getKoreksiTransfer } from "@/lib/transfer-kas-queries";

export const dynamic = "force-dynamic";

/**
 * Daftar koreksi "Jadikan transfer" (rencana 2026-11-11 U6; R15–R17, KTD7, KTD9).
 *
 * Baris bank "Setoran Hasil Penjualan" yang pada tanggal yang sama punya tepat
 * satu kaki keluar Kas Besar bernominal sama — kaki bank transfer yang salah
 * label (mengkredit 1103 dua kali). Per baris, sesudah konfirmasi eksplisit
 * (keputusan Dion 11 Nov 2026 17:54 WIB): void baris lama, sisip baru "Pindah
 * Buku" bertanggal sama, tautkan ke kaki Kas Besar, audit, jurnal dibentuk
 * ulang. Yang tak bisa dipasangkan otomatis tampil "periksa manual" tanpa
 * tombol.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca                     → `canViewLaporanKeuangan`
 *   · jadikan transfer          → `canJadikanTransfer` (keuangan, HoF, super admin)
 *   · … pada hari tertutup      → `canJadikanTransferHariTutup` (HoF, super admin) + alasan
 */
export default async function KoreksiTransferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const { siap, periksaManual } = await getKoreksiTransfer(unit.unit_id);

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-koreksi-transfer"
      />
      <h1 className="text-h3 t-brand">Koreksi kaki bank transfer Kas Besar</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} ·{" "}
        <a href={`/keuangan/unit/${unit.code}/${todayWib()}/input`}>kembali ke Input keuangan</a>
      </div>
      <p className="fs16 t-tertiary mt2">
        Setoran dari Kas Besar ke bank punya dua kaki: Kas Besar keluar &ldquo;Setoran ke Bank&rdquo; dan bank masuk
        &ldquo;Pindah Buku&rdquo;. Baris di bawah tercatat di bank sebagai &ldquo;Setoran Hasil Penjualan&rdquo;, yang
        mengurangi Penjualan Belum Disetor (1103) untuk kedua kalinya. &ldquo;Jadikan transfer&rdquo; membatalkan baris
        bank itu, mencatat ulang sebagai &ldquo;Pindah Buku&rdquo; dengan tanggal dan nominal yang sama, dan menautkannya
        ke kaki Kas Besar-nya. Sebelum dijalankan, kedua kaki ditampilkan dan Anda wajib mencentang konfirmasi. Saldo
        kas dan bank tidak berubah.
      </p>
      <div className="mt6">
        <KoreksiTransferPanel
          code={unit.code}
          unitNama={unit.name}
          siap={siap}
          periksaManual={periksaManual}
          bolehJadikan={canJadikanTransfer(ctx)}
          bolehHariTutup={canJadikanTransferHariTutup(ctx)}
        />
      </div>
    </>
  );
}
