import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import { join } from "path";

const IMAGE_DIR = process.env.IMAGE_STORAGE_PATH ?? join(process.cwd(), "..", "data", "images");

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

  // Find the latest report that has an image (disk or DB)
  const report = await prisma.edgeReport.findFirst({
    where: {
      cameraId: camera.id,
      eventImageIncluded: true,
    },
    orderBy: { receivedAt: "desc" },
    select: { id: true, eventImageMimeType: true, eventImageData: true },
  });

  if (!report) return new NextResponse(null, { status: 204 });

  const mimeType = report.eventImageMimeType ?? "image/jpeg";
  const headers = {
    "Content-Type": mimeType,
    "Cache-Control": "no-store, max-age=0",
  };

  // 1. Try disk first (new storage)
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const filePath = join(IMAGE_DIR, `${report.id}.${ext}`);
  try {
    const bytes = await readFile(filePath);
    return new NextResponse(bytes, { status: 200, headers });
  } catch {
    // 2. Fall back to DB blob for old records
    if (report.eventImageData) {
      return new NextResponse(new Uint8Array(report.eventImageData), { status: 200, headers });
    }
  }

  return new NextResponse(null, { status: 204 });
}
