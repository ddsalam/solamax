import {
  nadaPemeriksa,
  PENJELASAN_KOSONG,
  type BarisLaporan,
  type PanelLaporan,
} from "@/lib/keuangan-laporan-model";

/**
 * Satu panel laporan (Cash Flow · Income Statement · Balance Sheet).
 *
 * Komponen SERVER — Layar 2 read-only, jadi tak ada state, tak ada aksi, dan
 * tak ada JavaScript yang perlu dikirim ke peramban.
 *
 * ⛔ **Angka pemeriksa berdiri di KAKI panel dengan warna keadaan** — bukan sel
 * tersembunyi di kolom N seperti di workbook. Itulah satu-satunya perubahan
 * susunan yang kami buat terhadap sheet `LaporanHarian`.
 *
 * ⛔ **`null` ditampilkan sebagai "belum bisa dihitung" + SEBABNYA**, tidak
 * pernah sebagai `0` dan tidak pernah sebagai sel kosong. Laporan kosong yang
 * diam tak bisa dibedakan dari laporan nol.
 */

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function Nilai({ b }: { b: BarisLaporan }) {
  if (b.nilai === null) {
    return (
      <span className="right fs16 t-tertiary lap-kosong" title={b.sebab ? PENJELASAN_KOSONG[b.sebab] : undefined}>
        belum bisa dihitung
      </span>
    );
  }
  return <span className={`right num ${b.nilai < 0 ? "t-danger" : ""}`}>{rp(b.nilai)}</span>;
}

export function PanelLaporanKeuangan({
  judul,
  panel,
  catatan,
}: {
  judul: string;
  panel: PanelLaporan;
  /** Kalimat batas yang HARUS ikut panelnya, mis. batas SOValue di neraca. */
  catatan?: React.ReactNode;
}) {
  const nada = nadaPemeriksa(panel.pemeriksa.nilai);
  const sebabKosong = [...new Set(panel.baris.filter((b) => b.nilai === null && b.sebab).map((b) => b.sebab!))];

  return (
    <section className="card lap-panel" aria-labelledby={`lap-${judul}`}>
      <header className="lap-head">
        <h3 id={`lap-${judul}`} className="lap-judul">
          {judul}
        </h3>
      </header>
      <div className="lap-body">
        {panel.baris.map((b, i) => (
          <div className={`lap-ln${b.sum ? " sum" : ""}${b.ind ? " ind" : ""}`} key={`${b.label}-${i}`}>
            <span className="lap-k">{b.label}</span>
            <Nilai b={b} />
          </div>
        ))}

        {/* Angka pemeriksa — di kaki panel, berwarna keadaan. */}
        <div className={`lap-chk ${nada}`}>
          <span className="lap-k">{panel.pemeriksa.label}</span>
          <span className="right num">
            {panel.pemeriksa.nilai === null ? "belum bisa dihitung" : rp(panel.pemeriksa.nilai)}
          </span>
        </div>

        {sebabKosong.length > 0 && (
          <ul className="lap-sebab">
            {sebabKosong.map((s) => (
              <li key={s}>{PENJELASAN_KOSONG[s]}</li>
            ))}
          </ul>
        )}
        {catatan !== undefined && <div className="lap-sebab">{catatan}</div>}
      </div>
    </section>
  );
}
