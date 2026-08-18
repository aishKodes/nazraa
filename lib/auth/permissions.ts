import type { Role } from "@/types/platform";

export type Permission =
  | "dashboard.read"
  | "accounts.read"
  | "accounts.create"
  | "accounts.manage"
  | "users.read"
  | "hosts.read"
  | "hosts.review"
  | "agencies.read"
  | "agencies.create"
  | "hierarchy.read"
  | "wallet.read"
  | "coins.allocate"
  | "coins.transfer"
  | "coin_orders.read"
  | "coin_orders.manage"
  | "coin_packages.manage"
  | "sellers.manage"
  | "withdrawals.read"
  | "withdrawals.review"
  | "transactions.read"
  | "rooms.read"
  | "rooms.restrict"
  | "rooms.manage"
  | "documents.read"
  | "documents.upload"
  | "documents.manage"
  | "face_verification.read"
  | "face_verification.manage"
  | "gifts.read"
  | "gifts.manage"
  | "banners.read"
  | "banners.manage"
  | "notifications.read"
  | "notifications.manage"
  | "support.read"
  | "support.manage"
  | "reports.export"
  | "audit.read"
  | "risk.read"
  | "risk.manage"
  | "settings.manage";

const grants: Record<Role, Permission[]> = {
  MASTER: [
    "dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "users.read", "hosts.read", "hosts.review", "agencies.read", "agencies.create",
    "hierarchy.read", "wallet.read", "coins.allocate", "coins.transfer", "coin_orders.read", "coin_orders.manage", "coin_packages.manage", "sellers.manage", "withdrawals.read", "withdrawals.review",
    "transactions.read", "rooms.read", "rooms.restrict", "rooms.manage", "documents.read", "documents.upload", "documents.manage", "face_verification.read", "face_verification.manage", "gifts.read", "gifts.manage", "banners.read", "banners.manage", "notifications.read", "notifications.manage", "support.read", "support.manage", "reports.export", "audit.read", "risk.read", "risk.manage", "settings.manage",
  ],
  SUPER_ADMIN: ["dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "users.read", "hosts.read", "hosts.review", "agencies.read", "hierarchy.read", "wallet.read", "coin_orders.read", "coin_orders.manage", "coin_packages.manage", "sellers.manage", "withdrawals.read", "withdrawals.review", "transactions.read", "rooms.read", "documents.read", "documents.manage", "face_verification.read", "face_verification.manage", "gifts.read", "banners.read", "notifications.read", "support.read", "support.manage", "reports.export", "audit.read"],
  ADMIN: ["dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "users.read", "hosts.read", "hosts.review", "agencies.read", "agencies.create", "hierarchy.read", "wallet.read", "coins.transfer", "coin_orders.read", "coin_orders.manage", "sellers.manage", "withdrawals.read", "withdrawals.review", "transactions.read", "rooms.read", "documents.read", "documents.upload", "documents.manage", "face_verification.read", "face_verification.manage", "gifts.read", "banners.read", "notifications.read", "support.read", "support.manage", "reports.export"],
  AGENCY: ["dashboard.read", "accounts.read", "users.read", "hosts.read", "agencies.read", "hierarchy.read", "wallet.read", "coin_orders.read", "coin_orders.manage", "withdrawals.read", "gifts.read", "banners.read", "notifications.read", "support.read", "reports.export"],
  COIN_SELLER: ["dashboard.read", "accounts.read", "wallet.read", "coin_orders.read", "coin_orders.manage", "transactions.read", "withdrawals.read", "notifications.read", "support.read"],
  MONITORING_CS: ["dashboard.read", "accounts.read", "users.read", "hosts.read", "rooms.read", "rooms.restrict", "rooms.manage", "documents.read", "face_verification.read", "face_verification.manage", "gifts.read", "banners.read", "notifications.read", "support.read", "support.manage", "risk.read", "risk.manage"],
};

export function can(role: Role, permission: Permission) {
  return grants[role].includes(permission);
}
