"use client";

/**
 * CriticalAlertPopup — polls for new critical-category incidents and shows a
 * full-screen modal alert so operators cannot miss them.
 *
 * Critical categories (configured in alarm-engine.ts CRITICAL_ALERT_TYPES):
 *   • PPE Violation     — someone on site without required PPE
 *   • Smoking           — smoking detected on site
 *   • Fire Detected     — active fire or flame
 *   • Machinery Hazard  — worker too close to operating machinery
 *
 * The poll interval is 10 s.  `lastSeen` is stored in localStorage so the
 * pointer survives page navigations within the same browser tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 10_000;
const LS_KEY = "cmp_critical_last_seen";

type CriticalIncident = {
  id: string;
  type: string;
  riskLevel: string;
  reasoning: string | null;
  detectedAt: string;
  camera: { id: string; name: string } | null;
  project: { name: string } | null;
};

const INCIDENT_LABELS: Record<string, string> = {
  ppe_violation:    "PPE Violation",
  smoking:          "Smoking Detected",
  fire_detected:    "Fire Detected",
  machinery_hazard: "Machinery Hazard",
};

function riskColor(level: string) {
  const l = level.toLowerCase();
  if (l === "critical") return "bg-red-900/90 border-red-500";
  if (l === "high") return "bg-orange-900/90 border-orange-500";
  return "bg-yellow-900/80 border-yellow-500";
}

function badgeVariant(level: string): "destructive" | "default" | "secondary" {
  const l = level.toLowerCase();
  if (l === "critical" || l === "high") return "destructive";
  if (l === "medium") return "default";
  return "secondary";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-HK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CriticalAlertPopup() {
  const [queue, setQueue] = useState<CriticalIncident[]>([]);
  const lastSeenRef = useRef<string>(
    typeof window !== "undefined"
      ? (localStorage.getItem(LS_KEY) ?? new Date().toISOString())
      : new Date().toISOString()
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/incidents/critical-alerts?since=${encodeURIComponent(lastSeenRef.current)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json() as { incidents: CriticalIncident[] };
      if (data.incidents.length > 0) {
        // Advance the pointer to the newest incident so we don't re-show it
        const newest = data.incidents[0].detectedAt;
        lastSeenRef.current = newest;
        localStorage.setItem(LS_KEY, newest);
        setQueue((prev) => [...data.incidents.reverse(), ...prev]);
      }
    } catch {
      // Network error — silently skip poll
    }
  }, []);

  useEffect(() => {
    // Start polling immediately, then on interval
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // The topmost queued alert is the one currently shown
  const current = queue[0] ?? null;
  const remaining = queue.length - 1;

  function dismiss() {
    setQueue((prev) => prev.slice(1));
  }

  if (!current) return null;

  return (
    // Full-screen overlay — intentionally not closable by clicking outside
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className={`relative w-full max-w-md rounded-xl border-2 p-6 shadow-2xl ${riskColor(current.riskLevel)}`}
      >
        {/* Pulsing alert icon */}
        <div className="flex items-center gap-3 mb-4">
          <span className="relative flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest text-red-300">
            Critical Safety Alert
          </span>
        </div>

        {/* Incident type headline */}
        <h2 className="text-2xl font-bold text-white mb-1">
          {INCIDENT_LABELS[current.type] ?? current.type}
        </h2>

        {/* Camera / project */}
        <p className="text-sm text-white/80 mb-4">
          {current.camera?.name ?? "Unknown camera"}
          {current.project?.name ? ` · ${current.project.name}` : ""}
        </p>

        {/* Risk badge + time */}
        <div className="flex items-center gap-3 mb-4">
          <Badge variant={badgeVariant(current.riskLevel)}>
            {current.riskLevel.toUpperCase()}
          </Badge>
          <span className="text-xs text-white/60">{formatTime(current.detectedAt)}</span>
        </div>

        {/* Reasoning */}
        {current.reasoning && (
          <p className="text-sm text-white/70 italic mb-6 line-clamp-3">
            {current.reasoning}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={dismiss}
          >
            Acknowledge {remaining > 0 ? `(${remaining} more)` : ""}
          </Button>
          <Link href={`/incidents/${current.id}`} className="flex-1">
            <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10">
              View Incident →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
