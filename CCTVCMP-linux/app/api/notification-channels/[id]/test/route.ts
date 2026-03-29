import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications/email";
import { sendWebhook } from "@/lib/notifications/webhook";

/**
 * POST /api/notification-channels/[id]/test
 * Sends a test notification through the given channel.
 */
export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const channel = await prisma.notificationChannel.findUnique({
    where: { id: context.params.id },
  });
  if (!channel) return NextResponse.json({ message: "Channel not found" }, { status: 404 });

  const project = await prisma.project.findFirst();
  const camera = project
    ? await prisma.camera.findFirst({ where: { projectId: project.id } })
    : null;
  const zone = project
    ? await prisma.zone.findFirst({ where: { projectId: project.id } })
    : null;

  if (!project || !camera || !zone) {
    return NextResponse.json(
      { message: "Create a project, camera, and zone first to send test notifications." },
      { status: 400 }
    );
  }

  const testIncident = await prisma.incident.create({
    data: {
      projectId: project.id,
      cameraId: camera.id,
      zoneId: zone.id,
      type: "near_miss",
      riskLevel: "medium",
      status: "open",
      reasoning: "Test notification from CMP Settings. You can dismiss or delete this incident.",
    },
    include: {
      camera: { select: { name: true } },
      zone: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  let status = "sent";
  let error: string | null = null;

  try {
    switch (channel.type) {
      case "email":
        await sendEmail(channel.config as Record<string, unknown>, testIncident);
        break;
      case "webhook":
        await sendWebhook(channel.config as Record<string, unknown>, testIncident);
        break;
      case "dashboard":
        break;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  await prisma.notificationLog.create({
    data: {
      channelId: channel.id,
      incidentId: testIncident.id,
      status,
      error,
    },
  });

  return NextResponse.json({
    success: status === "sent",
    message: status === "sent" ? "Test notification sent." : error,
    incidentId: testIncident.id,
  });
}
