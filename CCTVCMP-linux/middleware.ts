import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/constants";
import { getRequiredRoles, hasRoleAccess } from "@/lib/rbac";

const authRoutes = ["/signin", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/webhook")) {
    return NextResponse.next();
  }

  const required = getRequiredRoles(pathname);
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!required && authRoutes.includes(pathname) && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!required) return NextResponse.next();

  if (!token) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  try {
    const payload = await verifyToken(token);
    if (!hasRoleAccess(payload.role, required)) {
      if (pathname.startsWith("/api")) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch {
    if (pathname.startsWith("/api")) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/edge-devices/:path*",
    "/incidents/:path*",
    "/analytics/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/signin",
    "/signup",
    "/api/:path*",
  ],
};
