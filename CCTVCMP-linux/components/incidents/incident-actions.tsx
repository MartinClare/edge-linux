"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { IncidentStatus } from "@prisma/client";

type Props = {
  incidentId: string;
  currentStatus: IncidentStatus;
};

export function IncidentActions({ incidentId, currentStatus }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(target: string) {
    setPending(target);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          typeof body?.message === "string"
            ? body.message
            : `Update failed (${res.status})`;
        setError(msg);
        return;
      }

      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(null);
    }
  }

  if (
    currentStatus === "resolved" ||
    currentStatus === "dismissed" ||
    currentStatus === "record_only"
  ) {
    return <span className="text-xs text-muted-foreground">No actions</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1 flex-wrap">
        {currentStatus === "open" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => updateStatus("acknowledged")}
            disabled={pending !== null}
          >
            {pending === "acknowledged" ? "..." : "Acknowledge"}
          </Button>
        )}
        {(currentStatus === "open" || currentStatus === "acknowledged") && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => updateStatus("resolved")}
            disabled={pending !== null}
          >
            {pending === "resolved" ? "..." : "Resolve"}
          </Button>
        )}
        {(currentStatus === "open" || currentStatus === "acknowledged") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateStatus("dismissed")}
            disabled={pending !== null}
          >
            {pending === "dismissed" ? "..." : "Dismiss"}
          </Button>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
