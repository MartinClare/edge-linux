import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { signUpSchema } from "@/lib/validations/auth";
import { hashPassword, setAuthCookie, signToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signUpSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) return NextResponse.json({ message: "Email already exists" }, { status: 409 });

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        hashedPassword: await hashPassword(parsed.data.password),
        role: parsed.data.role ?? Role.viewer,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = await signToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    const res = NextResponse.json({ user }, { status: 201 });
    setAuthCookie(res, token);
    return res;
  } catch {
    return NextResponse.json({ message: "Failed to sign up" }, { status: 500 });
  }
}
