"use client";

import { usePathname } from "next/navigation";

/**
 * Judul Monitoring realtime — pengganti MonTabs (titleOnly) setelah segmented
 * tabs dihapus. Hanya menulis H1 sesuai rute aktif; tak ada navigasi.
 */
export function MonHeading() {
  const path = usePathname();
  const title = path.startsWith("/monitoring/denah")
    ? "Denah tangki & nozzle"
    : path.startsWith("/monitoring/ketaatan")
      ? "Ketaatan administrasi"
      : "Jaringan SPBU";
  return <h1 className="text-h4 t-brand mt2">{title}</h1>;
}
