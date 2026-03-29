import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({ include: { cameras: true, zones: true }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ data: projects });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.name || !body.location) return NextResponse.json({ message: "name and location are required" }, { status: 400 });

  const project = await prisma.project.create({ data: { name: body.name, location: body.location } });
  return NextResponse.json({ data: project }, { status: 201 });
}
