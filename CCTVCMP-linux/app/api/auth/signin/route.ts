import { NextResponse } from "next/server";
import { signInSchema } from "@/lib/validations/auth";
import { prisma } from "@/lib/prisma";
import { setAuthCookie, signToken, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });

    const validPassword = await verifyPassword(parsed.data.password, user.hashedPassword);
    if (!validPassword) return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });

    const token = await signToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, { status: 200 });
    setAuthCookie(res, token);
    return res;
  } catch {
    return NextResponse.json({ message: "Failed to sign in" }, { status: 500 });
  }
}
