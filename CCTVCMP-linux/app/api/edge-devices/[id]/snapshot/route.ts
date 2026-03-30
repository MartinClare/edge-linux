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
  const data = new Uint8Array(report.eventImageData);

  // ETag: lightweight hash of the first 64 bytes of the image so the browser can
  // use If-None-Match for efficient polling (304 Not Modified = no body transfer).
  const etag = `"${Buffer.from(data.slice(0, 64)).toString("base64").replace(/[+/=]/g, "").slice(0, 24)}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304 });
  }

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "ETag": etag,
      // no-cache: browser must revalidate every time (can still use ETag / 304).
      // The client component already adds ?t= timestamps so ETag hits are rare,
      // but this ensures CDNs / proxies never serve a stale snapshot.
      "Cache-Control": "no-cache",
    },
  });
}
