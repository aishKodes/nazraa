import type { Role } from "@/types/platform";

export type Permission =
  | "dashboard.read"
  | "accounts.read"
  | "accounts.create"
  | "accounts.manage"
  | "accounts.edit"
  | "accounts.reassign"
  | "accounts.roles"
  | "accounts.permanent"
  | "users.read"
  | "users.moderate"
  | "users.permanent"
  | "hosts.read"
  | "hosts.review"
  | "agencies.read"
  | "agencies.create"
  | "agencies.review"
  | "hierarchy.read"
  | "monitoring.read"
  | "devices.read"
  | "devices.manage"
  | "wallet.read"
  | "coins.mint"
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
  | "face_live.authorize"
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

const master: Permission[] = [
  "dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "accounts.edit",
  "accounts.reassign", "accounts.roles", "accounts.permanent", "users.read", "users.moderate", "users.permanent",
  "hosts.read", "hosts.review", "agencies.read", "agencies.create", "agencies.review",
  "hierarchy.read", "monitoring.read", "devices.read", "devices.manage", "wallet.read",
  "coins.mint", "coins.allocate", "coins.transfer", "coin_orders.read", "coin_orders.manage",
  "coin_packages.manage", "sellers.manage", "withdrawals.read", "withdrawals.review",
  "transactions.read", "rooms.read", "rooms.restrict", "rooms.manage", "documents.read",
  "documents.upload", "documents.manage", "face_verification.read", "face_verification.manage",
  "face_live.authorize", "gifts.read", "gifts.manage", "banners.read", "banners.manage",
  "notifications.read", "notifications.manage", "support.read", "support.manage", "reports.export",
  "audit.read", "risk.read", "risk.manage", "settings.manage",
];

const countryManager: Permission[] = [
  "dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "accounts.edit",
  "accounts.roles", "documents.upload",
  "users.read", "users.moderate", "hosts.read", "hosts.review", "agencies.read", "agencies.create",
  "agencies.review", "hierarchy.read", "monitoring.read", "devices.read", "devices.manage",
  "wallet.read", "coins.allocate", "coins.transfer", "coin_orders.read", "coin_orders.manage",
  "sellers.manage", "withdrawals.read", "withdrawals.review", "transactions.read", "rooms.read",
  "rooms.restrict", "rooms.manage", "documents.read", "documents.manage", "face_verification.read",
  "face_verification.manage", "face_live.authorize", "support.read", "support.manage", "reports.export",
  "audit.read", "risk.read", "risk.manage",
];

const superAdmin: Permission[] = [
  "dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "accounts.edit",
  "documents.upload",
  "users.read", "users.moderate", "hosts.read", "hosts.review", "agencies.read", "agencies.create",
  "agencies.review", "hierarchy.read", "monitoring.read", "wallet.read", "coins.allocate",
  "coins.transfer", "coin_orders.read", "coin_orders.manage", "withdrawals.read", "withdrawals.review",
  "transactions.read", "rooms.read", "rooms.restrict", "rooms.manage", "documents.read",
  "documents.manage", "face_verification.read", "face_verification.manage", "face_live.authorize",
  "support.read", "support.manage", "reports.export", "audit.read", "risk.read", "risk.manage",
];

const branchAdmin: Permission[] = [
  "dashboard.read", "accounts.read", "accounts.create", "accounts.manage", "accounts.edit",
  "users.read", "users.moderate", "hosts.read", "hosts.review", "agencies.read", "agencies.create",
  "agencies.review", "hierarchy.read", "monitoring.read", "wallet.read", "coins.allocate",
  "coins.transfer", "coin_orders.read", "coin_orders.manage", "withdrawals.read", "withdrawals.review",
  "transactions.read", "rooms.read", "rooms.restrict", "rooms.manage", "documents.read",
  "documents.upload", "documents.manage", "face_verification.read", "face_verification.manage",
  "support.read", "support.manage", "reports.export", "risk.read", "risk.manage",
];

const grants: Record<Role, Permission[]> = {
  MASTER: master,
  COUNTRY_MANAGER: countryManager,
  SUPER_ADMIN: superAdmin,
  ADMIN: branchAdmin,
  BD: branchAdmin,
  AGENCY: [
    "dashboard.read", "users.read", "users.moderate", "hosts.read", "hosts.review", "agencies.read", "agencies.review",
    "monitoring.read", "wallet.read", "coins.transfer", "coin_orders.read", "coin_orders.manage",
    "withdrawals.read", "transactions.read", "rooms.read", "rooms.restrict", "documents.read",
    "documents.upload", "face_verification.read", "face_live.authorize", "support.read", "reports.export",
  ],
  COIN_SELLER: [
    "dashboard.read", "wallet.read", "coin_orders.read", "coin_orders.manage", "transactions.read",
  ],
  MONITORING_CS: [
    "dashboard.read", "users.read", "hosts.read", "monitoring.read", "rooms.read", "rooms.restrict",
    "support.read", "support.manage", "risk.read", "risk.manage", "audit.read",
  ],
};

export function can(role: Role, permission: Permission) {
  return grants[role].includes(permission);
}

export function permissionsFor(role: Role) {
  return grants[role];
}
