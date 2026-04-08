import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken, verifyPassword } from "@/lib/auth";
import { signInSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });

    const validPassword = await verifyPassword(parsed.data.password, user.hashedPassword);
    if (!validPassword) return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });

    const accessToken = await signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return NextResponse.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch {
    return NextResponse.json({ message: "Failed to sign in" }, { status: 500 });
  }
}
