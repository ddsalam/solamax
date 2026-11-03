import type { ReactNode } from "react";
import type { VonisTutupBulan } from "@/lib/tutup-bulan-model";

/**
 * Daftar periksa TUTUP BULAN (rencana 2026-10-29 U12; R25; KTD14) — empat
 * syarat, masing-masing OK atau hitungan penghalang dengan tautan ke layar yang
 * menyelesaikannya. Murni tampilan: vonisnya dihitung DI SERVER oleh
 * `periksaTutupBulan`, satu-satunya yang memutuskan — layar ini tidak menilai
 * apa pun sendiri.
 */

const rp = (sen: number): string => (sen / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });

function Baris({
  judul,
  ok,
  teks,
  children,
}: {
  judul: string;
  ok: boolean;
  teks: string;
  children?: ReactNode;
}) {
  return (
    <div className={`card card-pad tutup-syarat ${ok ? "baik" : "buruk"}`} data-syarat={judul}>
      <div>
        <div className="w600">{judul}</div>
        {children !== undefined && <div className="fs16 t-secondary mt2">{children}</div>}
      </div>
      <div className="tutup-angka num">{ok ? "OK" : teks}</div>
    </div>
  );
}

export function TutupBulanPeriksa({ code, bulan, vonis }: { code: string; bulan: string; vonis: VonisTutupBulan }) {
  const { hari, penampung, rekeningKoran, bukuTanpaPasangan } = vonis.syarat;
  const klasifikasi = `/keuangan/unit/${code}/impor-bank/${bulan}`;
  return (
    <div className="periksa-bulan mt4">
      <Baris judul="Semua hari ditutup" ok={hari.ok} teks={`${hari.jumlah} hari belum`}>
        {hari.ok ? (
          "Setiap hari kalender bulan ini sudah ditutup."
        ) : (
          <>
            Belum ditutup:{" "}
            {hari.belum.map((d, i) => (
              <span key={d}>
                {i > 0 && ", "}
                <a href={`/keuangan/unit/${code}/tutup-hari/${d}`}>{d.slice(8)}</a>
              </span>
            ))}
            . Hari yang belum pernah dibuka juga dihitung belum ditutup.
          </>
        )}
      </Baris>

      <Baris judul="Penampung nol" ok={penampung.ok} teks={`${penampung.jumlah} baris`}>
        {penampung.ok ? (
          "Tak ada mutasi bertanggal bank bulan ini yang masih diparkir."
        ) : (
          <>
            {penampung.jumlah} mutasi bertanggal bank bulan ini masih diparkir ({rp(penampung.totalSen)}) —{" "}
            <a href={klasifikasi}>pindahkan dari penampung</a>.
          </>
        )}
      </Baris>

      <Baris judul="Rekening koran lengkap" ok={rekeningKoran.ok} teks={`${rekeningKoran.jumlah} penghalang`}>
        {rekeningKoran.ok ? (
          "Setiap rekening bank yang bermutasi atau bersaldo bulan ini punya rekening koran aktif, dan semua barisnya sudah selesai."
        ) : (
          <>
            {rekeningKoran.belumDiimpor.length > 0 && (
              <>
                Belum ada rekening koran aktif:{" "}
                {rekeningKoran.belumDiimpor
                  .map((r) => (r.rekeningKoranMenunggu ? `${r.nama} (menunggu konfirmasi HoF)` : r.nama))
                  .join(", ")}{" "}
                — <a href={`/keuangan/unit/${code}/impor-bank`}>unggah atau konfirmasi di matriks impor</a>.{" "}
              </>
            )}
            {rekeningKoran.imporTerbuka > 0 && (
              <>
                {rekeningKoran.imporTerbuka} baris rekening koran belum dicocokkan atau diklasifikasi —{" "}
                <a href={klasifikasi}>selesaikan di layar klasifikasi</a>.
              </>
            )}
          </>
        )}
        {(rekeningKoran.wajib.length > 0 || rekeningKoran.dikecualikan.length > 0) && (
          <ul className="mt2" data-daftar="rekening-bank">
            {rekeningKoran.wajib.map((r) => (
              <li key={r.id} data-rekening="wajib">
                {r.nama} ·{" "}
                {r.rekeningKoranAktif ? "rekening koran aktif" : r.rekeningKoranMenunggu ? "menunggu konfirmasi HoF" : "belum ada rekening koran"}
              </li>
            ))}
            {rekeningKoran.dikecualikan.map((r) => (
              <li key={r.id} data-rekening="dikecualikan" className="t-tertiary">
                {r.nama} · saldo nol tanpa mutasi bulan ini — tidak dituntut
              </li>
            ))}
          </ul>
        )}
      </Baris>

      <Baris judul="Baris buku punya pasangan" ok={bukuTanpaPasangan.ok} teks={`${bukuTanpaPasangan.jumlah} baris`}>
        {bukuTanpaPasangan.ok ? (
          "Setiap baris buku di rekening bank bulan ini punya pasangan di rekening koran."
        ) : (
          <>
            {bukuTanpaPasangan.jumlah} baris buku tanpa pasangan di rekening koran —{" "}
            <a href={klasifikasi}>cocokkan di layar klasifikasi</a>.
            <ul className="mt2">
              {bukuTanpaPasangan.baris.map((b) => (
                <li key={b.id} data-jenis={b.jenis}>
                  <span className="num">{b.tanggalEfektif}</span> · {b.keterangan} ·{" "}
                  <span className="num">{rp(b.amountSen)}</span>
                  {b.jenis === "kaki_antar_unit" && <span className="keu-pill">kaki antar unit tanpa mutasi bank</span>}
                </li>
              ))}
            </ul>
            {bukuTanpaPasangan.nKakiAntarUnit > 0 && (
              <p className="fs16 t-tertiary mt2">
                Kaki antar unit yang dicatat dari rekening koran unit lain tidak akan muncul di rekening koran unit ini —
                baris seperti ini menahan tutup bulan sampai keputusan penanganannya ditetapkan.
              </p>
            )}
          </>
        )}
      </Baris>
    </div>
  );
}
