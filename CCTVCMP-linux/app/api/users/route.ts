import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getCurrentUserFromRequest, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: users });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.name || !body.email || !body.password) {
    return NextResponse.json({ message: "name, email, and password are required" }, { status: 400 });
  }

  const role = Object.values(Role).includes(body.role) ? body.role : Role.viewer;
  const created = await prisma.user.create({
    data: { name: body.name, email: body.email, hashedPassword: await hashPassword(body.password), role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
