import { MonTabs } from "@/components/mon/MonTabs";

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="board-head">
        <div>
          <div className="text-eyebrow t-tertiary">Monitoring Realtime</div>
          <MonTabs titleOnly />
        </div>
        <MonTabs />
      </div>
      {children}
    </div>
  );
}
