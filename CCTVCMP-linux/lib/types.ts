import { Incident, IncidentLog, Role, User } from "@prisma/client";

export type AppRole = Role;
export type JwtPayload = { sub: string; role: Role; email: string; name: string };
export type AuthUser = Pick<User, "id" | "name" | "email" | "role">;
export type IncidentWithRelations = Incident & {
  project: { id: string; name: string };
  camera: { id: string; name: string };
  zone: { id: string; name: string };
  assignee: { id: string; name: string; email: string } | null;
  logs: IncidentLog[];
};
