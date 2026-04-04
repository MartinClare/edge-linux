import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications/email";
import { sendWebhook } from "@/lib/notifications/webhook";

/**
 * POST /api/notification-channels/[id]/test
 * Sends a test notification through the given channel using a fully
 * in-memory mock — nothing is written to the database.
 */
export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const channel = await prisma.notificationChannel.findUnique({
    where: { id: context.params.id },
  });
  if (!channel) return NextResponse.json({ message: "Channel not found" }, { status: 404 });

  // Build a fully in-memory mock incident — no DB writes, no side effects.
  const mockIncident = {
    id: "test-0000",
    projectId: "test-project",
    cameraId: "test-camera",
    zoneId: "test-zone",
    edgeReportId: null,
    type: "ppe_violation" as const,
    riskLevel: "high" as const,
    status: "open" as const,
    recordOnly: false,
    notes: null,
    reasoning:
      "Worker detected in foreground without hard hat or high-visibility vest near active excavator. Two compliant workers visible in background wearing full PPE.",
    detectedAt: new Date(),
    acknowledgedAt: null,
    resolvedAt: null,
    dismissedAt: null,
    assignedTo: null,
    camera: { name: "Site Camera (TEST)" },
    zone: { name: "Construction Zone A" },
    project: { name: "Test Project" },
  };

  let status = "sent";
  let error: string | null = null;

  try {
    switch (channel.type) {
      case "email":
        await sendEmail(channel.config as Record<string, unknown>, mockIncident);
        break;
      case "webhook":
        await sendWebhook(channel.config as Record<string, unknown>, mockIncident);
        break;
      case "dashboard":
        break;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    success: status === "sent",
    message: status === "sent" ? "Test notification sent." : error,
  });
}
