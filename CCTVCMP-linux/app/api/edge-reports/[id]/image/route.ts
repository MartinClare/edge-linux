import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const report = await prisma.edgeReport.findUnique({
    where: { id: context.params.id },
    select: { eventImageData: true, eventImageMimeType: true },
  });

  if (!report?.eventImageData) {
    return NextResponse.json({ message: "Image not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(report.eventImageData), {
    status: 200,
    headers: {
      "Content-Type": report.eventImageMimeType || "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
