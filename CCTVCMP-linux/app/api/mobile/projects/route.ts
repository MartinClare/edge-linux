import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.admin) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const projects = await prisma.project.findMany({
    select: { id: true, name: true, location: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ projects });
}
