import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { IncidentRiskLevel } from "@prisma/client";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  minRiskLevel: z.nativeEnum(IncidentRiskLevel).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  consecutiveHits: z.number().int().min(1).optional(),
  dedupMinutes: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
  recordOnly: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const rule = await prisma.alarmRule.update({
    where: { id: context.params.id },
    data: parsed.data,
  });

  return NextResponse.json({ data: rule });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await prisma.alarmRule.delete({ where: { id: context.params.id } });
  return NextResponse.json({ message: "Deleted" });
}
