import { Card } from "./ui/Card";

export function ExtractCardSkeleton() {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div className="tn-skeleton" style={{ height: 20, width: "60%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 20, width: 56, borderRadius: 9999, flexShrink: 0 }} />
      </div>
      <div className="tn-skeleton" style={{ height: 12, width: 80, borderRadius: 4, marginBottom: 8 }} />
      <div
        style={{
          border: "1px solid var(--tn-border)",
          borderRadius: "var(--tn-r-control)",
          padding: 12,
          background: "var(--tn-surface-2)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div className="tn-skeleton" style={{ height: 14, width: "100%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "95%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "88%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "60%", borderRadius: 4 }} />
      </div>
    </Card>
  );
}
