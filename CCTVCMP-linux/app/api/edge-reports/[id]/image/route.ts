import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import { join } from "path";

const IMAGE_DIR = process.env.IMAGE_STORAGE_PATH ?? join(process.cwd(), "..", "data", "images");

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const report = await prisma.edgeReport.findUnique({
    where: { id: context.params.id },
    select: { eventImageMimeType: true, eventImageData: true },
  });

  if (!report) return NextResponse.json({ message: "Not found" }, { status: 404 });

  // 1. Try reading from local filesystem first (new storage)
  const mimeType = report.eventImageMimeType || "image/jpeg";
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const filePath = join(IMAGE_DIR, `${context.params.id}.${ext}`);

  try {
    const bytes = await readFile(filePath);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    // 2. Fall back to DB blob for old records
    if (report.eventImageData) {
      return new NextResponse(new Uint8Array(report.eventImageData), {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }

  return NextResponse.json({ message: "Image not found" }, { status: 404 });
}
