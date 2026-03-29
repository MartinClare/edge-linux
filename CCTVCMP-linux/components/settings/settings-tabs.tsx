"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EdgeIntegrationHelp } from "@/components/settings/edge-integration-help";

type AlarmRule = {
  id: string;
  name: string;
  incidentType: string;
  minRiskLevel: string;
  minConfidence: number;
  consecutiveHits: number;
  dedupMinutes: number;
  enabled: boolean;
  recordOnly: boolean;
};

type Channel = {
  id: string;
  name: string;
  type: string;
  config: unknown;
  minRiskLevel: string;
  enabled: boolean;
  _count: { logs: number };
};

export function SettingsTabs({ rules, channels }: { rules: AlarmRule[]; channels: Channel[] }) {
  const [tab, setTab] = useState<"rules" | "channels" | "edge">("rules");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant={tab === "rules" ? "default" : "outline"} onClick={() => setTab("rules")}>
          Alarm Rules
        </Button>
        <Button variant={tab === "channels" ? "default" : "outline"} onClick={() => setTab("channels")}>
          Notification Channels
        </Button>
        <Button variant={tab === "edge" ? "default" : "outline"} onClick={() => setTab("edge")}>
          Edge connection (PPE-UI)
        </Button>
      </div>

      {tab === "rules" ? (
        <AlarmRulesTab rules={rules} />
      ) : tab === "channels" ? (
        <NotificationChannelsTab channels={channels} />
      ) : (
        <EdgeIntegrationHelp />
      )}
    </div>
  );
}

function AlarmRulesTab({ rules }: { rules: AlarmRule[] }) {
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(id: string, field: "enabled" | "recordOnly", current: boolean) {
    setSaving(id);
    await fetch(`/api/alarm-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !current }),
    });
    setSaving(null);
    window.location.reload();
  }

  async function updateField(id: string, field: string, value: number | string) {
    await fetch(`/api/alarm-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Alarm Rules</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure when each incident type should trigger an alarm. Rules are auto-seeded for all types.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Min Risk</TableHead>
              <TableHead>Min Confidence</TableHead>
              <TableHead>Consecutive</TableHead>
              <TableHead>Dedup (min)</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Record Only</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell>
                  <select
                    className="rounded border bg-background px-2 py-1 text-sm"
                    defaultValue={rule.minRiskLevel}
                    onChange={(e) => updateField(rule.id, "minRiskLevel", e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-20"
                    defaultValue={rule.minConfidence}
                    onBlur={(e) => updateField(rule.id, "minConfidence", parseFloat(e.target.value))}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="1"
                    className="w-16"
                    defaultValue={rule.consecutiveHits}
                    onBlur={(e) => updateField(rule.id, "consecutiveHits", parseInt(e.target.value))}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="1"
                    className="w-16"
                    defaultValue={rule.dedupMinutes}
                    onBlur={(e) => updateField(rule.id, "dedupMinutes", parseInt(e.target.value))}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant={rule.enabled ? "default" : "outline"}
                    disabled={saving === rule.id}
                    onClick={() => toggle(rule.id, "enabled", rule.enabled)}
                  >
                    {rule.enabled ? "On" : "Off"}
                  </Button>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant={rule.recordOnly ? "secondary" : "outline"}
                    disabled={saving === rule.id}
                    onClick={() => toggle(rule.id, "recordOnly", rule.recordOnly)}
                  >
                    {rule.recordOnly ? "Yes" : "No"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NotificationChannelsTab({ channels }: { channels: Channel[] }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"email" | "webhook" | "dashboard">("dashboard");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function sendTest(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/notification-channels/${id}/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) alert("Test notification sent.");
      else alert(data.message ?? "Test failed.");
    } finally {
      setTestingId(null);
    }
  }

  async function createChannel() {
    setSaving(true);
    await fetch("/api/notification-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, config: {} }),
    });
    setSaving(false);
    setCreating(false);
    window.location.reload();
  }

  async function toggleEnabled(id: string, current: boolean) {
    await fetch(`/api/notification-channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !current }),
    });
    window.location.reload();
  }

  async function deleteChannel(id: string) {
    if (!confirm("Delete this notification channel?")) return;
    await fetch(`/api/notification-channels/${id}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Notification Channels</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure where incident alerts are sent. Dashboard notifications are always available.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(!creating)}>
            {creating ? "Cancel" : "Add Channel"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {creating && (
          <div className="flex items-end gap-3 rounded-md border p-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                className="rounded border bg-background px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="dashboard">Dashboard</option>
                <option value="email">Email</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>
            <Button onClick={createChannel} disabled={saving || !name}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        )}

        {channels.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No notification channels configured. Add one to start receiving alerts.
          </p>
        )}

        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center justify-between rounded-md border p-4">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{ch.type}</Badge>
              <div>
                <p className="font-medium text-sm">{ch.name}</p>
                <p className="text-xs text-muted-foreground">
                  Min risk: {ch.minRiskLevel} &middot; {ch._count.logs} notifications sent
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={testingId === ch.id}
                onClick={() => sendTest(ch.id)}
              >
                {testingId === ch.id ? "Sending..." : "Test"}
              </Button>
              <Button size="sm" variant={ch.enabled ? "default" : "outline"} onClick={() => toggleEnabled(ch.id, ch.enabled)}>
                {ch.enabled ? "Enabled" : "Disabled"}
              </Button>
              <Button size="sm" variant="outline" className="text-red-400" onClick={() => deleteChannel(ch.id)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
