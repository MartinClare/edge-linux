import { describe, expect, it } from "vitest";
import { hasRoleAccess, getRequiredRoles } from "@/lib/rbac";

describe("rbac", () => {
  it("gets required role from route map", () => {
    expect(getRequiredRoles("/settings")).toEqual(["admin", "project_manager"]);
    expect(getRequiredRoles("/unknown")).toBeNull();
  });

  it("checks role access correctly", () => {
    expect(hasRoleAccess("admin", ["admin"])).toBe(true);
    expect(hasRoleAccess("viewer", ["admin", "project_manager"])).toBe(false);
    expect(hasRoleAccess("viewer", null)).toBe(true);
  });
});
