"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function IncidentNotes({
  incidentId,
  currentNotes,
}: {
  incidentId: string;
  currentNotes: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(currentNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(
          typeof body?.message === "string"
            ? body.message
            : `Save failed (${res.status})`
        );
        setStatus("error");
        return;
      }

      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
      router.refresh();
    } catch {
      setErrorMsg("Network error — please try again.");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="w-full rounded-md border border-border bg-background p-3 text-sm min-h-[80px] resize-y"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add notes about this incident..."
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Notes"}
        </Button>
        {status === "saved" && (
          <span className="text-xs text-green-500">Saved</span>
        )}
        {status === "error" && (
          <span className="text-xs text-destructive">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
