import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { IncidentRiskLevel, IncidentType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const rules = await prisma.alarmRule.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ data: rules });
}

const createSchema = z.object({
  name: z.string().min(1),
  incidentType: z.nativeEnum(IncidentType),
  minRiskLevel: z.nativeEnum(IncidentRiskLevel).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  consecutiveHits: z.number().int().min(1).optional(),
  dedupMinutes: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
  recordOnly: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const rule = await prisma.alarmRule.create({ data: parsed.data });
  return NextResponse.json({ data: rule }, { status: 201 });
}
