import { NextRequest, NextResponse } from "next/server";
import { IncidentRiskLevel, Role } from "@prisma/client";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const RISKS: IncidentRiskLevel[] = ["low", "medium", "high", "critical"];

function defaultPreference(role: Role) {
  return {
    minRiskLevel: role === "viewer" ? "high" : "medium",
    criticalTypesOnly: false,
    alertsEnabled: true,
    projectIds: [] as string[],
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    preference: defaultPreference(user.role),
    projectScope: [],
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.admin) {
    return NextResponse.json(
      { message: "Only administrators can change mobile alert settings." },
      { status: 403 }
    );
  }

  let body: {
    minRiskLevel?: string;
    criticalTypesOnly?: boolean;
    alertsEnabled?: boolean;
    projectIds?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const preference = defaultPreference(user.role);
  if (typeof body.minRiskLevel === "string" && RISKS.includes(body.minRiskLevel as IncidentRiskLevel)) {
    preference.minRiskLevel = body.minRiskLevel as IncidentRiskLevel;
  }
  if (typeof body.criticalTypesOnly === "boolean") preference.criticalTypesOnly = body.criticalTypesOnly;
  if (typeof body.alertsEnabled === "boolean") preference.alertsEnabled = body.alertsEnabled;
  if (Array.isArray(body.projectIds)) {
    const ids = body.projectIds.filter((value): value is string => typeof value === "string");
    const validProjects = await prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    preference.projectIds = validProjects.map((project) => project.id);
    return NextResponse.json({ preference, projectScope: validProjects });
  }

  return NextResponse.json({ preference, projectScope: [] });
}
