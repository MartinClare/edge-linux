-- AlterTable
ALTER TABLE "edge_reports" ALTER COLUMN "event_timestamp" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "edge_report_id" TEXT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_edge_report_id_fkey" FOREIGN KEY ("edge_report_id") REFERENCES "edge_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
