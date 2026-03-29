-- AlterTable (idempotent for DBs that already have the column via db push)
ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "edge_camera_id" TEXT;

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "cameras_edge_camera_id_key" ON "cameras"("edge_camera_id");
