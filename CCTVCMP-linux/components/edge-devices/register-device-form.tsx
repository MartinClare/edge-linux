"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Project = { id: string; name: string; zones: { id: string; name: string }[] };

export function RegisterDeviceForm({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [edgeCameraId, setEdgeCameraId] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [zoneId, setZoneId] = useState(projects[0]?.zones[0]?.id ?? "");
  const router = useRouter();

  const selectedProject = projects.find((p) => p.id === projectId);
  const zones = selectedProject?.zones ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/edge-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          edgeCameraId: edgeCameraId.trim(),
          streamUrl: streamUrl.trim() || undefined,
          projectId,
          zoneId: zoneId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message ?? "Failed to register device");
        return;
      }
      setOpen(false);
      setName("");
      setEdgeCameraId("");
      setStreamUrl("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => setOpen(!open)} size="sm">
        {open ? "Cancel" : "Register Device"}
      </Button>
      {open && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Register Edge Camera</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Camera name"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Edge Camera ID</label>
                <Input
                  value={edgeCameraId}
                  onChange={(e) => setEdgeCameraId(e.target.value)}
                  placeholder="Unique ID from edge device"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Stream URL (optional)</label>
                <Input
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="https://...m3u8 or http://...mjpg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Project</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    const p = projects.find((x) => x.id === e.target.value);
                    setZoneId(p?.zones[0]?.id ?? "");
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Zone (optional)</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  <option value="">—</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Registering..." : "Register"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
