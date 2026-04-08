import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateIncidentSchema } from "@/lib/validations/incidents";
import { mapStatusToAction, nextStatus } from "@/lib/workflows/incident";
import { resolveMobilePublicBaseUrl } from "@/lib/runtime-config";

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const incident = await prisma.incident.findFirst({
    where: {
      id: context.params.id,
      OR: [{ notes: null }, { notes: { not: "__test__" } }],
    },
    select: {
      id: true,
      type: true,
      riskLevel: true,
      status: true,
      recordOnly: true,
      reasoning: true,
      notes: true,
      detectedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      dismissedAt: true,
      camera: { select: { name: true } },
      zone: { select: { name: true } },
      project: { select: { name: true } },
      assignee: { select: { name: true, email: true } },
      edgeReport: {
        select: {
          id: true,
          overallRiskLevel: true,
          overallDescription: true,
          peopleCount: true,
          missingHardhats: true,
          missingVests: true,
          receivedAt: true,
        },
      },
      notificationLogs: {
        select: {
          id: true,
          status: true,
          sentAt: true,
          channel: { select: { name: true, type: true } },
        },
        orderBy: { sentAt: "desc" },
      },
    },
  });

  if (!incident) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const publicBaseUrl = await resolveMobilePublicBaseUrl(request.url);
  return NextResponse.json({
    incident: {
      ...incident,
      edgeReport: incident.edgeReport
        ? {
            ...incident.edgeReport,
            imageUrl: `${publicBaseUrl}/api/edge-reports/${incident.edgeReport.id}/image`,
          }
        : null,
    },
  });
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = updateIncidentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const current = await prisma.incident.findUnique({ where: { id: context.params.id } });
  if (!current || current.notes === "__test__") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  if (parsed.data.status && !nextStatus(current.status, parsed.data.status)) {
    return NextResponse.json(
      { message: `Invalid status transition from ${current.status} to ${parsed.data.status}` },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.status) {
    updateData.status = parsed.data.status;
    if (parsed.data.status === "acknowledged") updateData.acknowledgedAt = new Date();
    if (parsed.data.status === "resolved") updateData.resolvedAt = new Date();
    if (parsed.data.status === "dismissed") updateData.dismissedAt = new Date();
  }

  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

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
    select: {
      id: true,
      type: true,
      riskLevel: true,
      status: true,
      recordOnly: true,
      reasoning: true,
      notes: true,
      detectedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      dismissedAt: true,
      camera: { select: { name: true } },
      zone: { select: { name: true } },
      project: { select: { name: true } },
      assignee: { select: { name: true, email: true } },
      edgeReport: {
        select: {
          id: true,
          overallRiskLevel: true,
          overallDescription: true,
          peopleCount: true,
          missingHardhats: true,
          missingVests: true,
          receivedAt: true,
        },
      },
      notificationLogs: {
        select: {
          id: true,
          status: true,
          sentAt: true,
          channel: { select: { name: true, type: true } },
        },
        orderBy: { sentAt: "desc" },
      },
    },
  });

  const publicBaseUrl = await resolveMobilePublicBaseUrl(request.url);
  return NextResponse.json({
    incident: {
      ...incident,
      edgeReport: incident.edgeReport
        ? {
            ...incident.edgeReport,
            imageUrl: `${publicBaseUrl}/api/edge-reports/${incident.edgeReport.id}/image`,
          }
        : null,
    },
  });
}
