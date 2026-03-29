import { Role } from "@prisma/client";

export const AUTH_COOKIE_NAME = "axon_cmp_token";

export const routeRoleMap: Record<string, Role[]> = {
  "/dashboard": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/edge-devices": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/incidents": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/analytics": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/reports": [Role.admin, Role.project_manager, Role.safety_officer],
  "/settings": [Role.admin, Role.project_manager],
  "/api/incidents": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/api/edge-devices": [Role.admin, Role.project_manager],
  "/api/edge-reports": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
  "/api/alarm-rules": [Role.admin, Role.project_manager],
  "/api/notification-channels": [Role.admin, Role.project_manager],
  "/api/projects": [Role.admin, Role.project_manager],
  "/api/users": [Role.admin],
  "/api/analytics": [Role.admin, Role.project_manager, Role.safety_officer, Role.viewer],
};
