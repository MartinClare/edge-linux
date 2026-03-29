-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('email', 'webhook', 'dashboard');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IncidentAction" ADD VALUE 'dismissed';
ALTER TYPE "IncidentAction" ADD VALUE 'note_added';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IncidentStatus" ADD VALUE 'dismissed';
ALTER TYPE "IncidentStatus" ADD VALUE 'record_only';

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "last_report_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "dismissed_at" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reasoning" TEXT,
ADD COLUMN     "record_only" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "edge_reports" (
    "id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "edge_camera_id" TEXT NOT NULL,
    "camera_name" TEXT NOT NULL,
    "overall_risk_level" TEXT NOT NULL,
    "overall_description" TEXT NOT NULL,
    "people_count" INTEGER,
    "missing_hardhats" INTEGER,
    "missing_vests" INTEGER,
    "raw_json" JSONB NOT NULL,
    "classification_json" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "incident_type" "IncidentType" NOT NULL,
    "min_risk_level" "IncidentRiskLevel" NOT NULL DEFAULT 'low',
    "min_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "consecutive_hits" INTEGER NOT NULL DEFAULT 1,
    "dedup_minutes" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "record_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "min_risk_level" "IncidentRiskLevel" NOT NULL DEFAULT 'low',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edge_reports_camera_id_idx" ON "edge_reports"("camera_id");

-- CreateIndex
CREATE INDEX "edge_reports_received_at_idx" ON "edge_reports"("received_at");

-- CreateIndex
CREATE INDEX "edge_reports_camera_id_received_at_idx" ON "edge_reports"("camera_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "alarm_rules_incident_type_key" ON "alarm_rules"("incident_type");

-- CreateIndex
CREATE INDEX "notification_logs_channel_id_idx" ON "notification_logs"("channel_id");

-- CreateIndex
CREATE INDEX "notification_logs_incident_id_idx" ON "notification_logs"("incident_id");

-- CreateIndex
CREATE INDEX "incidents_camera_id_type_detected_at_idx" ON "incidents"("camera_id", "type", "detected_at");

-- AddForeignKey
ALTER TABLE "edge_reports" ADD CONSTRAINT "edge_reports_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
