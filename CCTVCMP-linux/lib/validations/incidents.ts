import { IncidentRiskLevel, IncidentStatus, IncidentType } from "@prisma/client";
import { z } from "zod";

export const createIncidentSchema = z.object({
  projectId: z.string().min(1),
  cameraId: z.string().min(1),
  zoneId: z.string().min(1),
  type: z.nativeEnum(IncidentType),
  riskLevel: z.nativeEnum(IncidentRiskLevel),
  assignedTo: z.string().optional(),
});

export const updateIncidentSchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  assignedTo: z.string().nullable().optional(),
  notes: z.string().optional(),
});
