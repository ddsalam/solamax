import { AnomalyFeed } from "@/components/AnomalyFeed";
import { buildAnomalies } from "@/lib/anomalies";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** 4d · Feed anomali & exception — halaman penuh, dengan link ke laporan unit. */
export default async function AnomaliPage() {
  const scope = await getDataScope();
  const items = await buildAnomalies(scope.units);
  return (
    <div className="mt6">
      <AnomalyFeed items={items} />
    </div>
  );
}
