import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const cameraId = searchParams.get("cameraId");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  const where = cameraId ? { cameraId } : {};

  const [reports, total] = await Promise.all([
    prisma.edgeReport.findMany({
      where,
      include: {
        camera: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.edgeReport.count({ where }),
  ]);

  return NextResponse.json({ data: reports, total, limit, offset });
}
