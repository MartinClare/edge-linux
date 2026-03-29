import { NextResponse } from "next/server";

/** Public self-registration is disabled. Admins create users (e.g. SQL, internal tooling). */
export async function POST() {
  return NextResponse.json(
    { message: "Registration is disabled. Contact your administrator for an account." },
    { status: 403 },
  );
}
