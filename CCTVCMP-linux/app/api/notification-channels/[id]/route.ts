import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { IncidentRiskLevel } from "@prisma/client";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  minRiskLevel: z.nativeEnum(IncidentRiskLevel).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const channel = await prisma.notificationChannel.update({
    where: { id: context.params.id },
    data: parsed.data as Parameters<typeof prisma.notificationChannel.update>[0]["data"],
  });

  return NextResponse.json({ data: channel });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await prisma.notificationChannel.delete({ where: { id: context.params.id } });
  return NextResponse.json({ message: "Deleted" });
}
