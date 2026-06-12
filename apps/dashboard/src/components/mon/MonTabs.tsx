"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/monitoring", label: "Jaringan", title: "Jaringan — SPBU live", match: (p: string) => p === "/monitoring" || p.startsWith("/monitoring/denah") },
  { href: "/monitoring/ketaatan", label: "Ketaatan", title: "Heatmap ketaatan administrasi", match: (p: string) => p.startsWith("/monitoring/ketaatan") },
  { href: "/monitoring/anomali", label: "Anomali", title: "Feed anomali & exception", match: (p: string) => p.startsWith("/monitoring/anomali") },
];

export function MonTabs({ titleOnly = false }: { titleOnly?: boolean }) {
  const path = usePathname();
  const active = TABS.find((t) => t.match(path)) ?? TABS[0]!;

  if (titleOnly) {
    return (
      <h1 className="text-h4 t-brand mt2">
        {path.startsWith("/monitoring/denah") ? "Denah tangki & nozzle" : active.title}
      </h1>
    );
  }
  return (
    <div className="seg no-print">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`seg-btn${t.match(path) ? " active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
