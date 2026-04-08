import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getRuntimeConfig, setMobilePublicBaseUrl } from "@/lib/runtime-config";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.admin) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const config = await getRuntimeConfig();
  return NextResponse.json({ mobilePublicBaseUrl: config.mobilePublicBaseUrl ?? null });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.admin) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const config = await setMobilePublicBaseUrl(typeof body?.mobilePublicBaseUrl === "string" ? body.mobilePublicBaseUrl : null);
    return NextResponse.json({ mobilePublicBaseUrl: config.mobilePublicBaseUrl ?? null });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to save mobile config" },
      { status: 400 }
    );
  }
}
