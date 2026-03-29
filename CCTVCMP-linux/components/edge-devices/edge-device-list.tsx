"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHKT } from "@/lib/utils";

type Device = {
  id: string;
  name: string;
  edgeCameraId: string | null;
  status: string;
  lastReportAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
  zone: { id: string; name: string } | null;
  isOnline: boolean;
  latestReport: {
    id: string;
    overallRiskLevel: string;
    overallDescription: string;
    eventImagePath: string | null;
    receivedAt: string;
  } | null;
  latestAlertEvidence: {
    id: string;
    overallRiskLevel: string;
    eventImagePath: string;
    receivedAt: string;
  } | null;
  incidentCount: number;
  reportCount: number;
};

function riskBadge(level: string) {
  switch (level) {
    case "High": return <Badge variant="destructive">{level}</Badge>;
    case "Medium": return <Badge variant="default">{level}</Badge>;
    default: return <Badge variant="secondary">{level}</Badge>;
  }
}

export function EdgeDeviceList({ devices }: { devices: Device[] }) {
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleMaintenance(id: string, currentStatus: string) {
    setToggling(id);
    try {
      await fetch(`/api/edge-devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: currentStatus === "maintenance" ? "online" : "maintenance",
        }),
      });
      window.location.reload();
    } finally {
      setToggling(null);
    }
  }

  async function deleteDevice(id: string) {
    if (!confirm("Delete this edge device? This will also delete all its incidents and reports.")) return;
    await fetch(`/api/edge-devices/${id}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registered Edge Cameras</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Edge ID</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Last Report</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Reports</TableHead>
              <TableHead>Incidents</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No edge devices registered. Devices auto-register when they send their first report.
                </TableCell>
              </TableRow>
            )}
            {devices.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  {d.status === "maintenance" ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                      <span className="text-xs text-yellow-400">Maintenance</span>
                    </span>
                  ) : d.isOnline ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs text-green-400">Online</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                      <span className="text-xs text-red-400">Offline</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <Link href={`/edge-devices/${d.id}`} className="hover:underline">
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{d.edgeCameraId ?? "—"}</TableCell>
                <TableCell>{d.zone?.name ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {d.lastReportAt ? formatHKT(d.lastReportAt) : "Never"}
                </TableCell>
                <TableCell>
                  {d.latestReport ? riskBadge(d.latestReport.overallRiskLevel) : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {d.latestAlertEvidence ? (
                    <Link href={`/api/edge-reports/${d.latestAlertEvidence.id}/image`} target="_blank" className="underline">
                      View alert image
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No alerted evidence</span>
                  )}
                </TableCell>
                <TableCell>{d.reportCount}</TableCell>
                <TableCell>{d.incidentCount}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Link href={`/edge-devices/${d.id}`}>
                      <Button size="sm" variant="outline">
                        Edit
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={toggling === d.id}
                      onClick={() => toggleMaintenance(d.id, d.status)}
                    >
                      {d.status === "maintenance" ? "Enable" : "Maint."}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => deleteDevice(d.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
