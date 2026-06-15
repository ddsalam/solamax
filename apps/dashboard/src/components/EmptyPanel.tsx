/**
 * Panel "belum tersedia" — untuk seksi spec yang datanya belum di pipeline
 * (Domain 4–7: EDC, Deposit/Piutang, DO/alokasi, Tera, harga beli, setoran).
 * Hadir eksplisit agar tak ada panel yang hilang diam-diam.
 */
export function EmptyPanel({
  title,
  note,
  domain,
}: {
  title: string;
  note?: string;
  domain: string;
}) {
  return (
    <div className="na-panel">
      <div className="text-h6 t-brand">{title}</div>
      <p className="fs16 t-secondary mt2">
        Belum tersedia di pipeline — menunggu {domain}.
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
