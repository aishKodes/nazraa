import type { Role } from "@/types/platform";

export type Permission =
  | "dashboard.read"
  | "users.read"
  | "hosts.read"
  | "hosts.review"
  | "agencies.read"
  | "agencies.create"
  | "hierarchy.read"
  | "wallet.read"
  | "coins.transfer"
  | "withdrawals.read"
  | "withdrawals.review"
  | "transactions.read"
  | "rooms.read"
  | "rooms.restrict"
  | "reports.export"
  | "audit.read"
  | "risk.read"
  | "settings.manage";

const grants: Record<Role, Permission[]> = {
  MASTER: [
    "dashboard.read", "users.read", "hosts.read", "hosts.review", "agencies.read", "agencies.create",
    "hierarchy.read", "wallet.read", "coins.transfer", "withdrawals.read", "withdrawals.review",
    "transactions.read", "rooms.read", "rooms.restrict", "reports.export", "audit.read", "risk.read", "settings.manage",
  ],
  SUPER_ADMIN: ["dashboard.read", "users.read", "hosts.read", "hosts.review", "agencies.read", "hierarchy.read", "wallet.read", "withdrawals.read", "transactions.read", "rooms.read", "reports.export", "audit.read"],
  ADMIN: ["dashboard.read", "users.read", "hosts.read", "agencies.read", "agencies.create", "hierarchy.read", "wallet.read", "coins.transfer", "withdrawals.read", "transactions.read", "rooms.read", "reports.export"],
  AGENCY: ["dashboard.read", "users.read", "hosts.read", "agencies.read", "hierarchy.read", "withdrawals.read", "reports.export"],
  COIN_SELLER: ["dashboard.read", "wallet.read", "transactions.read", "withdrawals.read"],
  MONITORING_CS: ["dashboard.read", "users.read", "hosts.read", "rooms.read", "rooms.restrict", "risk.read"],
};

export function can(role: Role, permission: Permission) {
  return grants[role].includes(permission);
}
