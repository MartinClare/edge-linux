import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ChannelType, IncidentRiskLevel } from "@prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const channels = await prisma.notificationChannel.findMany({
    include: { _count: { select: { logs: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data: channels });
}

const createSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(ChannelType),
  config: z.record(z.string(), z.unknown()).optional(),
  minRiskLevel: z.nativeEnum(IncidentRiskLevel).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const channel = await prisma.notificationChannel.create({ data: parsed.data as Parameters<typeof prisma.notificationChannel.create>[0]["data"] });
  return NextResponse.json({ data: channel }, { status: 201 });
}
