import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateIncidentSchema } from "@/lib/validations/incidents";
import { mapStatusToAction, nextStatus } from "@/lib/workflows/incident";

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const incident = await prisma.incident.findUnique({
    where: { id: context.params.id },
    include: {
      project: true,
      camera: true,
      zone: true,
      assignee: true,
      logs: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { timestamp: "desc" } },
      notificationLogs: {
        include: { channel: { select: { name: true, type: true } } },
        orderBy: { sentAt: "desc" },
      },
    },
  });

  if (!incident) return NextResponse.json({ message: "Not found" }, { status: 404 });
  return NextResponse.json({ data: incident });
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = updateIncidentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const current = await prisma.incident.findUnique({ where: { id: context.params.id } });
  if (!current) return NextResponse.json({ message: "Not found" }, { status: 404 });

  if (parsed.data.status && !nextStatus(current.status, parsed.data.status)) {
    return NextResponse.json({ message: `Invalid status transition from ${current.status} to ${parsed.data.status}` }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (typeof parsed.data.assignedTo !== "undefined") updateData.assignedTo = parsed.data.assignedTo;

  if (parsed.data.status) {
    updateData.status = parsed.data.status;
    if (parsed.data.status === "acknowledged") updateData.acknowledgedAt = new Date();
    if (parsed.data.status === "resolved") updateData.resolvedAt = new Date();
    if (parsed.data.status === "dismissed") updateData.dismissedAt = new Date();
  }

  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes;
  }

  const logAction = parsed.data.status
    ? mapStatusToAction(parsed.data.status)
    : parsed.data.notes !== undefined
    ? "note_added"
    : "updated";

  const incident = await prisma.incident.update({
    where: { id: current.id },
    data: {
      ...updateData,
      logs: { create: { userId: user.id, action: logAction } },
    },
    include: {
      project: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      logs: true,
    },
  });

  return NextResponse.json({ data: incident });
}
