import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { IncidentNotes } from "@/components/incidents/incident-notes";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatHKT } from "@/lib/utils";

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const incident = await prisma.incident.findUnique({
    where: { id: params.id },
    include: {
      project: true,
      camera: true,
      zone: true,
      assignee: true,
      logs: {
        include: { user: { select: { name: true } } },
        orderBy: { timestamp: "asc" },
      },
      notificationLogs: {
        include: { channel: { select: { name: true, type: true } } },
        orderBy: { sentAt: "desc" },
      },
    },
  });

  if (!incident) notFound();

  const evidenceBefore = await prisma.edgeReport.findFirst({
    where: {
      cameraId: incident.cameraId,
      eventImagePath: { not: null },
      receivedAt: { lte: incident.detectedAt },
    },
    select: {
      id: true,
      eventImagePath: true,
      overallRiskLevel: true,
      overallDescription: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "desc" },
  });

  const evidenceAfter = await prisma.edgeReport.findFirst({
    where: {
      cameraId: incident.cameraId,
      eventImagePath: { not: null },
      receivedAt: { gte: incident.detectedAt },
    },
    select: {
      id: true,
      eventImagePath: true,
      overallRiskLevel: true,
      overallDescription: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const evidence = (() => {
    const candidates = [evidenceBefore, evidenceAfter].filter(Boolean) as Array<NonNullable<typeof evidenceBefore>>;
    if (candidates.length === 0) return null;
    const nearest = candidates.sort((a, b) =>
      Math.abs(a.receivedAt.getTime() - incident.detectedAt.getTime()) -
      Math.abs(b.receivedAt.getTime() - incident.detectedAt.getTime())
    )[0];
    const diffMs = Math.abs(nearest.receivedAt.getTime() - incident.detectedAt.getTime());
    return diffMs <= 2 * 60 * 60 * 1000 ? nearest : null;
  })();

  const riskColor = incident.riskLevel === "critical" || incident.riskLevel === "high"
    ? "destructive" as const
    : "secondary" as const;

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={15} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">
            {incident.type.replace(/_/g, " ")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {incident.camera.name} &middot; {incident.zone?.name} &middot; {incident.project.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={riskColor}>{incident.riskLevel}</Badge>
          <Badge variant="outline">{incident.status.replace("_", " ")}</Badge>
          {incident.recordOnly && <Badge variant="secondary">record only</Badge>}
          <IncidentActions incidentId={incident.id} currentStatus={incident.status} />
        </div>
      </div>

      {/* Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Detected" value={formatHKT(incident.detectedAt)} />
            {incident.acknowledgedAt && <Row label="Acknowledged" value={formatHKT(incident.acknowledgedAt)} />}
            {incident.resolvedAt && <Row label="Resolved" value={formatHKT(incident.resolvedAt)} />}
            {incident.dismissedAt && <Row label="Dismissed" value={formatHKT(incident.dismissedAt)} />}
            <Row label="Assigned To" value={incident.assignee?.name ?? "Unassigned"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">AI Reasoning</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {incident.reasoning || "No reasoning available."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
        <CardContent>
          <IncidentNotes incidentId={incident.id} currentNotes={incident.notes} />
        </CardContent>
      </Card>

      {/* Evidence */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Evidence Image</CardTitle></CardHeader>
        <CardContent>
          {evidence?.eventImagePath ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    evidence.overallRiskLevel === "High" || evidence.overallRiskLevel === "Critical"
                      ? "destructive"
                      : evidence.overallRiskLevel === "Medium"
                      ? "default"
                      : "secondary"
                  }
                >
                  {evidence.overallRiskLevel}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Captured: {formatHKT(evidence.receivedAt)}
                </span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={evidence.eventImagePath}
                alt="Incident evidence"
                className="max-h-[420px] w-full rounded border object-contain"
              />
              <p className="text-sm text-muted-foreground">{evidence.overallDescription}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No evidence image available for this incident.</p>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {incident.logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                <div>
                  <span className="font-medium">{log.action.replace("_", " ")}</span>
                  <span className="text-muted-foreground"> by {log.user.name}</span>
                  <p className="text-xs text-muted-foreground">{formatHKT(log.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Notification History */}
      {incident.notificationLogs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Notifications Sent</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {incident.notificationLogs.map((nl) => (
                <div key={nl.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div>
                    <span className="font-medium">{nl.channel.name}</span>
                    <span className="text-muted-foreground"> ({nl.channel.type})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={nl.status === "sent" ? "secondary" : "destructive"}>
                      {nl.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatHKT(nl.sentAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
