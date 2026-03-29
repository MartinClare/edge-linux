"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  deviceId: string;
  status: string;
  onUpdate?: () => void;
};

export function EdgeDeviceActions({ deviceId, status, onUpdate }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();

  async function toggleMaintenance() {
    setPending("maintenance");
    try {
      await fetch(`/api/edge-devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status === "maintenance" ? "online" : "maintenance" }),
      });
      onUpdate?.();
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function deleteDevice() {
    if (!confirm("Delete this edge device? This will also delete all its incidents and reports.")) return;
    setPending("delete");
    try {
      await fetch(`/api/edge-devices/${deviceId}`, { method: "DELETE" });
      router.push("/edge-devices");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending !== null}
        onClick={toggleMaintenance}
      >
        {pending === "maintenance" ? "..." : status === "maintenance" ? "Enable" : "Maintenance"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-red-500 hover:text-red-400"
        disabled={pending !== null}
        onClick={deleteDevice}
      >
        {pending === "delete" ? "..." : "Delete"}
      </Button>
    </div>
  );
}
