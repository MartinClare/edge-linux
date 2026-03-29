import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createIncidentSchema } from "@/lib/validations/incidents";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const incidents = await prisma.incident.findMany({
    include: {
      project: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      logs: true,
    },
    orderBy: { detectedAt: "desc" },
  });

  return NextResponse.json({ data: incidents });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createIncidentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const incident = await prisma.incident.create({
    data: {
      ...parsed.data,
      status: "open",
      logs: { create: { userId: user.id, action: "created" } },
    },
    include: {
      project: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      logs: true,
    },
  });

  return NextResponse.json({ data: incident }, { status: 201 });
}
