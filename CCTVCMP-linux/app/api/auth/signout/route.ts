import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const url = new URL("/signin", request.url);
  const response = NextResponse.redirect(url);
  clearAuthCookie(response);
  return response;
}
