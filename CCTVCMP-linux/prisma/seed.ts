import { PrismaClient, Role, IncidentRiskLevel, IncidentType, IncidentStatus, CameraStatus } from "@prisma/client";
import { hash } from "bcryptjs";
import { subDays } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@axonvision.com" },
    update: {},
    create: {
      name: "System Admin",
      email: "admin@axonvision.com",
      hashedPassword: await hash("Admin@123456", 12),
      role: Role.admin,
    },
  });

  const safetyOfficer = await prisma.user.upsert({
    where: { email: "safety@axonvision.com" },
    update: {},
    create: {
      name: "Safety Officer",
      email: "safety@axonvision.com",
      hashedPassword: await hash("Safety@123456", 12),
      role: Role.safety_officer,
    },
  });

  const project = await prisma.project.upsert({
    where: { id: "demo-project-1" },
    update: {},
    create: { id: "demo-project-1", name: "Metro Station Phase 2", location: "Downtown District" },
  });

  const zoneA = await prisma.zone.upsert({
    where: { id: "zone-a" },
    update: {},
    create: { id: "zone-a", projectId: project.id, name: "Excavation Zone A", riskLevel: IncidentRiskLevel.high },
  });

  await prisma.camera.upsert({
    where: { id: "cam-1" },
    update: {},
    create: { id: "cam-1", name: "Gate North Cam", projectId: project.id, zoneId: zoneA.id, status: CameraStatus.online },
  });

  await prisma.incident.upsert({
    where: { id: "incident-demo-1" },
    update: {},
    create: {
      id: "incident-demo-1",
      projectId: project.id,
      cameraId: "cam-1",
      zoneId: zoneA.id,
      type: IncidentType.ppe_violation,
      riskLevel: IncidentRiskLevel.high,
      status: IncidentStatus.open,
      assignedTo: safetyOfficer.id,
    },
  });

  for (let i = 0; i < 14; i++) {
    const d = subDays(new Date(), i);
    d.setHours(0, 0, 0, 0);
    await prisma.dailyMetric.upsert({
      where: { projectId_date: { projectId: project.id, date: d } },
      update: {},
      create: {
        projectId: project.id,
        date: d,
        totalIncidents: Math.floor(Math.random() * 15) + 2,
        avgResponseTime: Math.round((Math.random() * 25 + 6) * 10) / 10,
        ppeComplianceRate: Math.round((Math.random() * 18 + 80) * 10) / 10,
      },
    });
  }

  console.log(`Seeded. admin@axonvision.com / Admin@123456. User: ${admin.email}`);
}

main().finally(async () => prisma.$disconnect());
