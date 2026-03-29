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

/** Incident types that always show a blocking popup alert in the CMP UI. */
const CRITICAL_ALERT_TYPES = ["ppe_violation", "smoking", "fire_detected", "machinery_hazard"];

export function SettingsTabs({ rules, channels }: { rules: AlarmRule[]; channels: Channel[] }) {
  const [tab, setTab] = useState<"critical" | "rules" | "channels" | "edge">("critical");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant={tab === "critical" ? "default" : "outline"} onClick={() => setTab("critical")}>
          Critical Alerts
        </Button>
        <Button variant={tab === "rules" ? "default" : "outline"} onClick={() => setTab("rules")}>
          All Alarm Rules
        </Button>
        <Button variant={tab === "channels" ? "default" : "outline"} onClick={() => setTab("channels")}>
          Notification Channels
        </Button>
        <Button variant={tab === "edge" ? "default" : "outline"} onClick={() => setTab("edge")}>
          Edge connection (PPE-UI)
        </Button>
      </div>

      {tab === "critical" ? (
        <CriticalAlertsTab rules={rules.filter((r) => CRITICAL_ALERT_TYPES.includes(r.incidentType))} />
      ) : tab === "rules" ? (
        <AlarmRulesTab rules={rules} />
      ) : tab === "channels" ? (
        <NotificationChannelsTab channels={channels} />
      ) : (
        <EdgeIntegrationHelp />
      )}
    </div>
  );
}

const CRITICAL_LABELS: Record<string, { label: string; description: string }> = {
  ppe_violation:    { label: "PPE Violation",    description: "Someone on site without required hard hat or hi-vis vest" },
  smoking:          { label: "Smoking",           description: "Smoking detected on site" },
  fire_detected:    { label: "Fire Detected",     description: "Active flame or fire visible" },
  machinery_hazard: { label: "Machinery Hazard",  description: "Worker too close to operating machinery" },
};

function CriticalAlertsTab({ rules }: { rules: AlarmRule[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(rules.map((r) => [r.id, r.dedupMinutes]))
  );

  async function saveCooldown(id: string) {
    setSaving(id);
    await fetch(`/api/alarm-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dedupMinutes: values[id] }),
    });
    setSaving(null);
  }

  return (
    <div className="space-y-4">
      <Card className="border-orange-500/30 bg-orange-950/10">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
            Critical Safety Alerts
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These four incident types trigger an immediate blocking popup in the CMP UI so
            operators cannot miss them. A cooldown prevents duplicate popups for the same camera
            within the configured window. The popup reappears automatically when a new event
            occurs after the cooldown expires.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Rules not yet seeded — trigger a webhook report to auto-create them.
            </p>
          )}
          {rules.map((rule) => {
            const meta = CRITICAL_LABELS[rule.incidentType];
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-orange-500/20 bg-orange-950/20 p-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{meta?.label ?? rule.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta?.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="destructive" className="text-xs">HIGH risk floor</Badge>
                    <Badge variant="outline" className="text-xs">Popup enabled</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Cooldown (minutes)</p>
                    <Input
                      type="number"
                      min="1"
                      max="60"
                      className="w-20 text-center"
                      value={values[rule.id] ?? rule.dedupMinutes}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [rule.id]: parseInt(e.target.value) || 1 }))
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={saving === rule.id || values[rule.id] === rule.dedupMinutes}
                    onClick={() => saveCooldown(rule.id)}
                    className="mt-5"
                  >
                    {saving === rule.id ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
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
