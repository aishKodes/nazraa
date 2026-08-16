import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatNumber } from "@/lib/utils/format";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "violet" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  const valueUpper = value.toUpperCase();
  const tone = ["ACTIVE", "APPROVED", "COMPLETED", "VERIFIED", "OPEN"].includes(valueUpper)
    ? "success"
    : ["SUSPENDED", "REJECTED", "BANNED", "FAILED", "DISABLED", "HIGH"].includes(valueUpper)
      ? "danger"
      : ["PENDING", "UNDER_REVIEW", "PROCESSING", "MEDIUM"].includes(valueUpper)
        ? "warning"
        : "neutral";
  return <Badge tone={tone}>{value.replaceAll("_", " ")}</Badge>;
}

export function MetricCard({ label, value, detail, trend, icon }: { label: string; value: number | string; detail?: string; trend?: number; icon: ReactNode }) {
  const direction = trend === undefined || trend === 0 ? "flat" : trend > 0 ? "up" : "down";
  return <article className="metric-card">
    <div className="metric-icon">{icon}</div>
    <p>{label}</p>
    <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    <div className={`metric-detail ${direction}`}>
      {direction === "up" ? <ArrowUpRight size={14} /> : direction === "down" ? <ArrowDownRight size={14} /> : <Minus size={14} />}
      <span>{detail ?? "No comparison yet"}</span>
    </div>
  </article>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading">
    <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
    {action}
  </div>;
}

export function Notice({ type = "info", children }: { type?: "info" | "success" | "error"; children: ReactNode }) {
  return <div className={`notice notice-${type}`}>{children}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
