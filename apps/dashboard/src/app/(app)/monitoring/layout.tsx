import { MonHeading } from "@/components/mon/MonHeading";

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div>
        <div className="text-eyebrow t-tertiary">Monitoring realtime</div>
        <MonHeading />
      </div>
      {children}
    </div>
  );
}
