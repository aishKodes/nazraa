export const roles = [
  "MASTER",
  "SUPER_ADMIN",
  "ADMIN",
  "AGENCY",
  "COIN_SELLER",
  "MONITORING_CS",
] as const;

export type Role = (typeof roles)[number];

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type PlatformAccount = {
  id: string;
  publicId: string;
  role: Role;
  roleCode: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: AccountStatus;
  parentAccountId: string | null;
};

export type SessionAccount = Pick<PlatformAccount, "id" | "publicId" | "role" | "fullName">;

export type Scope = {
  account: SessionAccount;
  accountIds: string[];
  isGlobal: boolean;
};

export type DashboardMetrics = {
  users: number;
  hosts: number;
  agencies: number;
  activeRooms: number;
  revenue: number;
  pendingWithdrawals: number;
  coinInventory: number;
};

export type LedgerEntry = {
  id: string;
  transactionCode: string;
  assetType: "COIN" | "DIAMOND" | "CASH";
  transactionType: string;
  sourceName: string;
  destinationName: string;
  amount: number;
  status: string;
  createdAt: string;
};
