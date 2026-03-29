import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/edge-devices/[id]/snapshot
 *
 * Returns the most recent stored JPEG (or other image) for a camera.
 * The image bytes are stored in EdgeReport.eventImageData by the webhook handler
 * whenever the edge device sends a multipart report that includes a frame.
 *
 * Responses:
 *   200  image/jpeg (or original MIME)  — latest available frame
 *   204  No Content                     — camera exists but no image stored yet
 *   401  Unauthorized
 *   404  Camera not found
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return new NextResponse(null, { status: 401 });

  const camera = await prisma.camera.findUnique({
    where: { id: context.params.id },
    select: { id: true },
  });
  if (!camera) return new NextResponse(null, { status: 404 });

  // Find the latest report that has actual image bytes stored
  const report = await prisma.edgeReport.findFirst({
    where: {
      cameraId: camera.id,
      eventImageData: { not: null },
    },
    orderBy: { receivedAt: "desc" },
    select: { eventImageData: true, eventImageMimeType: true },
  });

  if (!report?.eventImageData) {
    // No stored image yet — caller can show a placeholder
    return new NextResponse(null, { status: 204 });
  }

  const mimeType = report.eventImageMimeType ?? "image/jpeg";
  return new NextResponse(report.eventImageData, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      // Cache for 30 s so repeated page loads don't hit the DB repeatedly,
      // but the thumbnail refreshes naturally on next page load.
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
    },
  });
}
