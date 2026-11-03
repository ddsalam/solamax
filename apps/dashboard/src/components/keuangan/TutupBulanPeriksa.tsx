import type { ReactNode } from "react";
import type { CekBukuBesar, VonisCekBukuBesar } from "@/lib/buku-besar-cek";
import type { VonisTutupBulan } from "@/lib/tutup-bulan-model";

/**
 * Daftar periksa TUTUP BULAN (rencana 2026-10-29 U12; R25; KTD14) — empat
 * syarat, masing-masing OK atau hitungan penghalang dengan tautan ke layar yang
 * menyelesaikannya. Murni tampilan: vonisnya dihitung DI SERVER oleh
 * `periksaTutupBulan`, satu-satunya yang memutuskan — layar ini tidak menilai
 * apa pun sendiri.
 *
 * K6 U11 (R33): baris kelima "Buku besar" bila vonis membawa pemeriksaannya —
 * setiap cek ✔/✘ dengan pos, rekening, dan butir dalam perjalanan disebut
 * namanya. Di halaman, cek dihitung dari jurnal TERSIMPAN; tombol Tutup
 * membentuk ulang jurnal bulan ini lalu memeriksa lagi (termasuk harga beli).
 */

const rp = (sen: number): string => (sen / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });

function Baris({
  judul,
  ok,
  teks,
  angka,
  children,
}: {
  judul: string;
  ok: boolean;
  teks: string;
  /** Pengganti "OK" di kolom kanan (mis. "Belum aktif"). */
  angka?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`card card-pad tutup-syarat ${ok ? "baik" : "buruk"}`} data-syarat={judul}>
      <div>
        <div className="w600">{judul}</div>
        {children !== undefined && <div className="fs16 t-secondary mt2">{children}</div>}
      </div>
      <div className="tutup-angka num">{angka ?? (ok ? "OK" : teks)}</div>
    </div>
  );
}

const rpBertanda = (sen: number): string => `${rp(Math.abs(sen))}${sen < 0 ? " (kredit)" : ""}`;

function Cek({ id, hasil, judul, children }: { id: string; hasil: "ok" | "gagal" | "belum"; judul: string; children?: ReactNode }) {
  const tanda = hasil === "ok" ? "✔" : hasil === "gagal" ? "✘" : "–";
  return (
    <li data-cek={id} data-hasil={hasil} className={hasil === "gagal" ? "" : "t-secondary"}>
      <span aria-hidden="true">{tanda}</span> {judul}
      {children !== undefined && <div className="t-tertiary">{children}</div>}
    </li>
  );
}

function DaftarCek({ cek }: { cek: CekBukuBesar }) {
  const { saldoAwalPos, neraca, kliringNol, perjalanan, bank, hargaBeli } = cek;
  const hasil = (ok: boolean) => (ok ? "ok" : "gagal");
  return (
    <ul className="mt2" data-daftar="cek-buku-besar">
      <Cek id="saldo-awal" hasil={hasil(saldoAwalPos.ok)} judul="Saldo awal pos lengkap dan seimbang">
        {!saldoAwalPos.ok &&
          (saldoAwalPos.jumlahBaris === 0 ? "Saldo awal pos kosong." : `Beda ${rpBertanda(saldoAwalPos.totalSen)}.`)}
      </Cek>
      <Cek id="neraca" hasil={hasil(neraca.ok)} judul="Neraca saldo seimbang">
        Debet <span className="num">{rp(neraca.debetSen)}</span> · kredit <span className="num">{rp(neraca.kreditSen)}</span>
      </Cek>
      <Cek id="kliring-nol" hasil={hasil(kliringNol.ok)} judul="1198 dan 1199 Rp 0">
        {kliringNol.pos
          .filter((p) => p.saldoSen !== 0)
          .map((p) => (
            <div key={p.posKode}>
              Pos {p.posKode}: <span className="num">{rpBertanda(p.saldoSen)}</span>
            </div>
          ))}
      </Cek>
      <Cek id="perjalanan" hasil={hasil(perjalanan.ok)} judul="1103 dan 1190 Rp 0, kecuali butir dalam perjalanan">
        {perjalanan.pos
          .filter((p) => p.saldoSen !== 0)
          .map((p) => (
            <div key={p.posKode}>
              Pos {p.posKode}: saldo <span className="num">{rpBertanda(p.saldoSen)}</span>
              {p.sisaSen !== 0 && (
                <>
                  {" "}
                  · bukan butir dalam perjalanan <span className="num">{rpBertanda(p.sisaSen)}</span>
                </>
              )}
              {p.butir.length > 0 && (
                <ul data-daftar="perjalanan">
                  {p.butir.map((b) => (
                    <li key={b.jurnalId}>
                      <span className="num">{b.tanggalEfektif}</span> · {b.keterangan} ·{" "}
                      <span className="num">{rpBertanda(b.netSen)}</span> · pasangan{" "}
                      <span className="num">{b.tanggalPasangan}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </Cek>
      <Cek id="bank" hasil={hasil(bank.ok)} judul="Saldo sub-pos bank = saldo akhir rekening koran">
        {bank.rekening.map((r) => (
          <div key={r.posKode} data-sub-pos={r.posKode} data-hasil={r.ok ? "ok" : "gagal"}>
            {r.ok ? "✔" : "✘"} {r.posKode} {r.nama}: buku besar <span className="num">{rpBertanda(r.saldoBukuSen)}</span> ·
            rekening koran{" "}
            {r.saldoRekeningKoranSen === null ? "belum ada" : <span className="num">{rpBertanda(r.saldoRekeningKoranSen)}</span>}
          </div>
        ))}
      </Cek>
      <Cek
        id="harga-beli"
        hasil={hargaBeli.diperiksa ? hasil(hargaBeli.ok) : "belum"}
        judul={'Tidak ada temuan "harga beli belum diisi"'}
      >
        {hargaBeli.diperiksa
          ? hargaBeli.temuan.map((t) => (
              <div key={`${t.tanggal}|${t.produk ?? ""}`}>
                <span className="num">{t.tanggal}</span> · {t.produk ?? "produk"}
              </div>
            ))
          : "Diperiksa saat tombol Tutup ditekan, ketika jurnal bulan ini dibentuk ulang."}
      </Cek>
    </ul>
  );
}

function BarisBukuBesar({ vonis }: { vonis: VonisCekBukuBesar }) {
  if (!vonis.aktif) {
    return (
      <Baris judul="Buku besar" ok teks="" angka="Belum aktif">
        {vonis.alasanTidakAktif} Bulan ini ditutup tanpa pemeriksaan buku besar.
      </Baris>
    );
  }
  return (
    <Baris judul="Buku besar" ok={vonis.boleh} teks={`${vonis.alasan.length} penghalang`}>
      Dihitung dari jurnal tersimpan, menurut tanggal efektif s.d. akhir bulan. Tombol Tutup membentuk ulang jurnal bulan ini
      lalu memeriksa lagi.
      <DaftarCek cek={vonis.cek} />
    </Baris>
  );
}

export function TutupBulanPeriksa({ code, bulan, vonis }: { code: string; bulan: string; vonis: VonisTutupBulan }) {
  const { hari, penampung, rekeningKoran, bukuTanpaPasangan, bukuBesar } = vonis.syarat;
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

      {bukuBesar !== null && <BarisBukuBesar vonis={bukuBesar} />}
    </div>
  );
}
