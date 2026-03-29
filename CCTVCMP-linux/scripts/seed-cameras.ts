/**
 * seed-cameras.ts — pre-register edge cameras in the CMP database.
 *
 * Reads camera definitions either from:
 *   1. The CAMERAS env var (JSON array, see format below), OR
 *   2. The hardcoded list at the bottom of this file (edit as needed).
 *
 * CAMERAS format:
 *   '[{"id":"camera1","name":"Lobby","streamUrl":"rtsp://..."},...]'
 *
 * Run:
 *   npm run seed-cameras
 *
 * The script is safe to re-run — it upserts by edgeCameraId so existing
 * records are updated rather than duplicated.
 */

import { PrismaClient } from "@prisma/client";

type CameraSpec = {
  /** Must match the `id` field in app.config.json */
  id: string;
  name: string;
  streamUrl?: string;
};

// ── Camera list ───────────────────────────────────────────────────────────────
// Override with CAMERAS env var (JSON), or edit this array directly.
const DEFAULT_CAMERAS: CameraSpec[] = [
  { id: "camera1", name: "Lobby",      streamUrl: "rtsp://fnnas.cccl4s.com:8554/site_b_01" },
  { id: "camera2", name: "Front Door", streamUrl: "rtsp://fnnas.cccl4s.com:8554/site_b_02" },
  { id: "camera3", name: "Exit 3",     streamUrl: "rtsp://fnnas.cccl4s.com:8554/site_b_03" },
  { id: "camera4", name: "Camera 4",   streamUrl: "rtsp://fnnas.cccl4s.com:8554/site_b_05" },
];

const PROJECT_NAME = process.env.SEED_PROJECT_NAME?.trim() || "Edge Site";
const ZONE_NAME    = process.env.SEED_ZONE_NAME?.trim()    || "Default Zone";

void (async () => {
  let cameras: CameraSpec[] = DEFAULT_CAMERAS;

  const camerasEnv = process.env.CAMERAS?.trim();
  if (camerasEnv) {
    try {
      cameras = JSON.parse(camerasEnv) as CameraSpec[];
    } catch {
      console.error("CAMERAS env var is not valid JSON — using hardcoded list.");
    }
  }

  const prisma = new PrismaClient();
  try {
    // 1. Ensure a project exists
    let project = await prisma.project.findFirst({ where: { name: PROJECT_NAME } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: PROJECT_NAME, location: "Edge Device" },
      });
      console.log(`Created project: "${project.name}" (${project.id})`);
    } else {
      console.log(`Using existing project: "${project.name}" (${project.id})`);
    }

    // 2. Ensure a zone exists inside that project
    let zone = await prisma.zone.findFirst({ where: { projectId: project.id, name: ZONE_NAME } });
    if (!zone) {
      zone = await prisma.zone.create({
        data: { projectId: project.id, name: ZONE_NAME, riskLevel: "medium" },
      });
      console.log(`Created zone: "${zone.name}" (${zone.id})`);
    } else {
      console.log(`Using existing zone: "${zone.name}" (${zone.id})`);
    }

    // 3. Upsert each camera
    console.log(`\nRegistering ${cameras.length} camera(s)…`);
    for (const cam of cameras) {
      const existing = await prisma.camera.findUnique({ where: { edgeCameraId: cam.id } });
      if (existing) {
        await prisma.camera.update({
          where: { id: existing.id },
          data: {
            name: cam.name,
            streamUrl: cam.streamUrl ?? existing.streamUrl,
            projectId: project.id,
            zoneId: zone.id,
          },
        });
        console.log(`  ✓ Updated:  ${cam.id} → "${cam.name}"`);
      } else {
        await prisma.camera.create({
          data: {
            edgeCameraId: cam.id,
            name: cam.name,
            streamUrl: cam.streamUrl,
            projectId: project.id,
            zoneId: zone.id,
          },
        });
        console.log(`  ✓ Created:  ${cam.id} → "${cam.name}"`);
      }
    }

    console.log("\nDone. All cameras are registered in the CMP.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
