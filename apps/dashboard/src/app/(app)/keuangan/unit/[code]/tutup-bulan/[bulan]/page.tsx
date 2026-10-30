import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TutupBulanPeriksa } from "@/components/keuangan/TutupBulanPeriksa";
import { TutupBulanTombol } from "@/components/keuangan/TutupBulanTombol";
import { geserBulan } from "@/lib/bulan";
import { unitDotted, unitLabel } from "@/lib/config";
import { canTutupBulan, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { daftarBulan } from "@/lib/impor-bank-model";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";
import { bulanTutupSah, periksaTutupBulan } from "@/lib/tutup-bulan-model";
import { getBahanTutupBulan, getTutupBulan } from "@/lib/tutup-bulan-queries";
import { ukur } from "@/lib/ukur-kueri";

export const dynamic = "force-dynamic";

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * TUTUP BULAN per unit (rencana 2026-10-29 U12; R25; KTD14).
 *
 * Daftar periksa empat syarat — semua hari ditutup, penampung nol, rekening
 * koran lengkap, baris buku punya pasangan — masing-masing OK atau hitungan
 * penghalang dengan tautan ke layar yang menyelesaikannya. Vonisnya dari
 * `periksaTutupBulan`, fungsi yang SAMA yang dipakai aksi di bawah kuncinya.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca  → `canViewLaporanKeuangan`
 *   · tutup → `canTutupBulan` (HoF + super admin) — tombolnya hanya tampil
 *     bagi mereka, dan aktif hanya bila keempat syarat OK.
 */
export default async function TutupBulanPage({ params }: { params: Promise<{ code: string; bulan: string }> }) {
  const { code, bulan } = await params;
  if (!bulanTutupSah(bulan)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  // Diukur (`[ukur] tutup-bulan …` di log): render ±60 dtk di pilot 30 Okt 2026
  // belum punya sebab terbukti — kueri halaman ini ringan, jadi angka nyata
  // dulu sebelum mengoptimalkan apa pun.
  const [bahan, tertutup] = await ukur("tutup-bulan", () =>
    Promise.all([getBahanTutupBulan(unit.unit_id, bulan), getTutupBulan(unit.unit_id, bulan)]),
  );
  const vonis = periksaTutupBulan(bahan);
  const bolehTutup = canTutupBulan(ctx);
  const labelBulan = `${NAMA_BULAN[Number(bulan.slice(5, 7)) - 1]} ${bulan.slice(0, 4)}`;
  const hariIni = todayWib();
  const sebelum = geserBulan(bulan, -1);
  const sesudah = geserBulan(bulan, 1);
  const adaSesudah = daftarBulan(sesudah, hariIni.slice(0, 7)).length > 0;

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-tutup-bulan"
        date={`${bulan}-01`}
        today={hariIni}
        maxDate={hariIni}
      />
      <h1 className="text-h3 t-brand">Tutup bulan · {labelBulan}</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} ·{" "}
        <a href={`/keuangan/unit/${unit.code}/tutup-bulan/${sebelum}`}>‹ {sebelum}</a>
        {adaSesudah && (
          <>
            {" · "}
            <a href={`/keuangan/unit/${unit.code}/tutup-bulan/${sesudah}`}>{sesudah} ›</a>
          </>
        )}
      </div>
      <p className="fs16 t-tertiary mt2">
        Bulan ditutup Head of Finance per unit setelah setiap mutasi rekening koran BCA bulan ini punya tempat yang
        benar di buku. Penampung boleh bersaldo selama hari-hari berjalan, tetapi wajib nol sebelum bulan ditutup.
      </p>

      {tertutup !== null ? (
        <div className="banner info keu-banner mt4" role="status">
          <b>Bulan ini sudah ditutup</b>
          <p className="keu-p">
            Ditutup {tertutup.ditutupAt} WIB{tertutup.ditutupOleh ? ` oleh ${tertutup.ditutupOleh}` : ""}. Daftar di
            bawah adalah keadaan buku SAAT INI, bukan saat penutupan.
          </p>
        </div>
      ) : vonis.boleh ? (
        <div className="banner info keu-banner mt4" role="status">
          Keempat syarat terpenuhi — bulan ini siap ditutup.
        </div>
      ) : (
        <div className="banner warning keu-banner mt4" role="status">
          Bulan belum bisa ditutup: {vonis.alasan.join(" ")}
        </div>
      )}

      <TutupBulanPeriksa code={unit.code} bulan={bulan} vonis={vonis} />

      {bolehTutup && tertutup === null && <TutupBulanTombol code={unit.code} bulan={bulan} siap={vonis.boleh} />}
    </>
  );
}
