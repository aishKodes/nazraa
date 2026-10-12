export function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function formatCurrency(value: number | string | null | undefined, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const instant = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2} \d/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  if (!Number.isFinite(instant.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(instant);
}

export function initials(name: string) {
  return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}
