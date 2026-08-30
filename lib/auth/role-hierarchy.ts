import type { Role } from "@/types/platform";

export const roleLabels: Record<Role, string> = {
  MASTER: "Master",
  COUNTRY_MANAGER: "Country Manager",
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  BD: "BD",
  AGENCY: "Agency",
  COIN_SELLER: "Coin Seller",
  MONITORING_CS: "Monitoring / CS",
};

const creatable: Record<Role, Role[]> = {
  MASTER: ["COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"],
  COUNTRY_MANAGER: ["SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER"],
  SUPER_ADMIN: ["ADMIN", "BD", "AGENCY"],
  ADMIN: ["AGENCY", "COIN_SELLER"],
  BD: ["AGENCY", "COIN_SELLER"],
  AGENCY: [],
  COIN_SELLER: [],
  MONITORING_CS: [],
};

const manageable: Record<Role, Role[]> = {
  MASTER: ["COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"],
  COUNTRY_MANAGER: ["SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"],
  SUPER_ADMIN: ["ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"],
  ADMIN: ["AGENCY", "COIN_SELLER", "MONITORING_CS"],
  BD: ["AGENCY", "COIN_SELLER", "MONITORING_CS"],
  AGENCY: [],
  COIN_SELLER: [],
  MONITORING_CS: [],
};

export function rolesCreatableBy(role: Role) {
  return creatable[role];
}

export function canManageRole(actor: Role, target: Role) {
  return manageable[actor].includes(target);
}

export function rolesAssignableBy(actor: Role): Role[] {
  return actor === "MASTER" || actor === "COUNTRY_MANAGER" ? creatable[actor] : [];
}

export function validParentRoles(role: Role): Role[] {
  switch (role) {
    case "COUNTRY_MANAGER":
      return ["MASTER"];
    case "SUPER_ADMIN":
      return ["COUNTRY_MANAGER"];
    case "ADMIN":
    case "BD":
      return ["SUPER_ADMIN"];
    case "AGENCY":
      return ["ADMIN", "BD"];
    case "COIN_SELLER":
    case "MONITORING_CS":
      return ["COUNTRY_MANAGER", "ADMIN", "BD"];
    case "MASTER":
      return [];
  }
}

export function isParentRoleValid(child: Role, parent: Role) {
  return validParentRoles(child).includes(parent);
}

export function roleLabel(role: Role) {
  return roleLabels[role];
}
