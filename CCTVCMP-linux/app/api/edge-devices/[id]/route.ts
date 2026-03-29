import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const camera = await prisma.camera.findUnique({
    where: { id: context.params.id },
    include: {
      project: true,
      zone: true,
      edgeReports: {
        orderBy: { receivedAt: "desc" },
        take: 20,
      },
      _count: { select: { incidents: true, edgeReports: true } },
    },
  });

  if (!camera) return NextResponse.json({ message: "Not found" }, { status: 404 });
  return NextResponse.json({ data: camera });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  streamUrl: z.string().trim().min(1).nullable().optional(),
  zoneId: z.string().optional(),
  status: z.enum(["online", "offline", "maintenance"]).optional(),
});

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const camera = await prisma.camera.update({
    where: { id: context.params.id },
    data: parsed.data,
  });

  return NextResponse.json({ data: camera });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await prisma.camera.delete({ where: { id: context.params.id } });
  return NextResponse.json({ message: "Deleted" });
}
