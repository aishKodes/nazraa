import assert from "node:assert/strict";
import { can } from "@/lib/auth/permissions";
import { isParentRoleValid, rolesAssignableBy, rolesCreatableBy, validParentRoles } from "@/lib/auth/role-hierarchy";
import { roles, type Role } from "@/types/platform";

assert.deepEqual(roles, ["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER", "MONITORING_CS"]);

for (const role of roles) {
  assert.equal(can(role, "dashboard.read"), true, `${role} needs its own overview`);
  assert.equal(can(role, "users.permanent"), role === "MASTER", `${role} permanent-user rule`);
  assert.equal(can(role, "accounts.permanent"), role === "MASTER", `${role} permanent-account rule`);
  assert.equal(can(role, "coins.mint"), role === "MASTER", `${role} coin-mint rule`);
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
assert.equal(can("COIN_SELLER", "coin_orders.manage"), true);
assert.equal(can("MONITORING_CS", "monitoring.read"), true);
assert.equal(can("MONITORING_CS", "rooms.restrict"), true);
assert.equal(can("MONITORING_CS", "rooms.manage"), false);
assert.equal(can("MONITORING_CS", "wallet.read"), false);

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
