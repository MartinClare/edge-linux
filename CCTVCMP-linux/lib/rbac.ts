import { Role } from "@prisma/client";
import { routeRoleMap } from "@/lib/constants";

export function getRequiredRoles(pathname: string): Role[] | null {
  const key = Object.keys(routeRoleMap).find((route) => pathname.startsWith(route));
  return key ? routeRoleMap[key] : null;
}

export function hasRoleAccess(role: Role, allowed: Role[] | null) {
  if (!allowed) return true;
  return allowed.includes(role);
}
