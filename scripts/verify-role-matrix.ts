import assert from "node:assert/strict";
import { can } from "@/lib/auth/permissions";
import { isParentRoleValid, rolesAssignableBy, rolesCreatableBy, validParentRoles } from "@/lib/auth/role-hierarchy";
import { roles, type Role } from "@/types/platform";

assert.deepEqual(roles, ["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"]);

for (const role of roles) {
  assert.equal(can(role, "dashboard.read"), true, `${role} needs its own overview`);
  assert.equal(can(role, "users.permanent"), role === "MASTER", `${role} permanent-user rule`);
  assert.equal(can(role, "face_live.suspend"), role === "MASTER" || role === "MONITORING_CS", `${role} dedicated Face Live suspension rule`);
  assert.equal(can(role, "accounts.permanent"), role === "MASTER", `${role} permanent-account rule`);
  assert.equal(can(role, "coins.mint"), role === "MASTER", `${role} coin-mint rule`);
  assert.equal(can(role, "wallet.adjust"), role === "MASTER", `${role} manual-user-balance adjustment rule`);
  assert.equal(can(role, "settings.manage"), role === "MASTER", `${role} global-settings rule`);
  assert.equal(can(role, "accounts.reassign"), role === "MASTER", `${role} hierarchy-reassignment rule`);
  assert.equal(can(role, "accounts.roles"), ["MASTER", "COUNTRY_MANAGER"].includes(role), `${role} role assignment rule`);
  assert.equal(rolesAssignableBy(role).includes("MASTER"), false);
  assert.equal(rolesAssignableBy(role).includes("COUNTRY_MANAGER"), role === "MASTER");
}

assert.equal(can("COUNTRY_MANAGER", "devices.manage"), true);
assert.equal(can("SUPER_ADMIN", "devices.manage"), false);
assert.equal(can("ADMIN", "devices.manage"), false);
assert.equal(can("COUNTRY_MANAGER", "withdrawals.review"), true);
assert.equal(can("SUPER_ADMIN", "withdrawals.review"), true);
assert.equal(can("ADMIN", "withdrawals.review"), true);
assert.equal(can("AGENCY", "withdrawals.review"), false);
assert.equal(can("AGENCY", "agencies.review"), true);
assert.equal(can("AGENCY", "accounts.read"), false);
assert.equal(can("COIN_SELLER", "users.read"), false);
assert.equal(can("COIN_SELLER", "coins.transfer"), true);
assert.equal(can("COIN_SELLER", "reports.export"), false, "Coin Seller must not inherit Live/Game reports");
assert.equal(can("AGENCY", "reports.export"), true, "Agency report access uses its existing report permission");
assert.equal(can("AGENCY", "hierarchy.read"), false, "Agency does not receive the broader hierarchy report");
assert.equal(can("MASTER", "hierarchy.read"), true);
assert.equal(can("MONITORING_CS", "coins.transfer"), false, "Monitoring access must not reveal seller transfers");
assert.equal(can("COIN_SELLER", "coin_orders.manage"), true);
assert.equal(can("MONITORING_CS", "monitoring.read"), true);
assert.equal(can("MONITORING_CS", "rooms.restrict"), true);
assert.equal(can("MONITORING_CS", "face_live.suspend"), true);
assert.equal(can("MONITORING_CS", "users.permanent"), false);
assert.equal(can("MONITORING_CS", "rooms.manage"), false);
assert.equal(can("MONITORING_CS", "wallet.read"), false);
for (const role of ["AGENCY", "ADMIN", "SUPER_ADMIN"] as const) {
  assert.equal(can(role, "monitoring.read"), false);
  assert.equal(can(role, "face_verification.read"), false);
  assert.equal(can(role, "face_verification.manage"), false);
}
assert.equal(can("ADMIN", "accounts.edit"), false);
assert.equal(can("ADMIN", "accounts.manage"), false);
assert.equal(can("MASTER", "accounts.manage"), true);
assert.equal(can("MONITORING_CS", "games.read"), true);
assert.equal(can("MONITORING_CS", "live_reports.read"), true);
assert.equal(can("MONITORING_CS", "devices.manage"), true);
assert.equal(can("AGENCY", "games.read"), false);
assert.equal(can("AGENCY", "live_reports.read"), true);

const parentMatrix: Record<Role, Role[]> = {
  MASTER: [],
  COUNTRY_MANAGER: ["MASTER"],
  SUPER_ADMIN: ["COUNTRY_MANAGER"],
  ADMIN: ["SUPER_ADMIN"],
  BD: ["SUPER_ADMIN"],
  AGENCY: ["ADMIN", "BD"],
  COIN_SELLER: ["COUNTRY_MANAGER", "ADMIN", "BD"],
  MONITORING_CS: ["COUNTRY_MANAGER", "ADMIN", "BD"],
};

for (const child of roles) {
  assert.deepEqual(validParentRoles(child), parentMatrix[child], `${child} parent list`);
  for (const parent of roles) {
    assert.equal(isParentRoleValid(child, parent), parentMatrix[child].includes(parent), `${child} under ${parent}`);
  }
}

assert.deepEqual(rolesCreatableBy("COUNTRY_MANAGER"), ["SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER"]);
assert.equal(rolesAssignableBy("COUNTRY_MANAGER").includes("SUPER_ADMIN"), true);
assert.equal(can("AGENCY", "hosts.review"), true);
assert.equal(can("COUNTRY_MANAGER", "agencies.review"), true);
assert.equal(can("COUNTRY_MANAGER", "documents.upload"), true);
assert.deepEqual(rolesCreatableBy("SUPER_ADMIN"), ["ADMIN", "BD", "AGENCY"]);
assert.deepEqual(rolesCreatableBy("ADMIN"), ["AGENCY", "COIN_SELLER"]);
assert.deepEqual(rolesCreatableBy("BD"), ["AGENCY", "COIN_SELLER"]);
assert.deepEqual(rolesCreatableBy("AGENCY"), []);
assert.deepEqual(rolesCreatableBy("MONITORING_CS"), []);

console.log("Role matrix verified for Master, Country Manager, Super Admin, Admin, BD, Agency, Coin Seller, and Monitoring/CS.");
