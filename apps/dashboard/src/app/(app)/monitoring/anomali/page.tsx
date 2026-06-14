import { AnomalyFeed } from "@/components/AnomalyFeed";
import { buildAnomalies } from "@/lib/anomalies";
import { getUnits } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** 4d · Feed anomali & exception — halaman penuh, dengan link ke laporan unit. */
export default async function AnomaliPage() {
  const units = await getUnits();
  const items = await buildAnomalies(units);
  return (
    <div className="mt6">
      <AnomalyFeed items={items} />
    </div>
  );
}
