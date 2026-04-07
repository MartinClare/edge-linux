"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatHKT } from "@/lib/utils";
import { useTranslations } from "next-intl";

type AlertItem = {
  id: string;
  type: string;
  riskLevel: string;
  status: string;
  cameraName: string;
  detectedAt: string;
};

export function AlertFeed({ incidents }: { incidents: AlertItem[] }) {
  const t = useTranslations("dashboard");
  const tIncidents = useTranslations("incidents");
  const tCommon = useTranslations("common");
  const display = incidents.slice(0, 20);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("recentAlerts")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[320px] overflow-y-auto space-y-2">
          {display.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("noRecentIncidents")}</p>
          ) : (
            display.map((inc) => (
              <Link
                key={inc.id}
                href={`/incidents/${inc.id}`}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{tIncidents(`types.${inc.type}` as Parameters<typeof tIncidents>[0]) || inc.type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground"> · {inc.cameraName}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge
                    variant={
                      inc.riskLevel === "critical" || inc.riskLevel === "high"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {tCommon(`riskLevel.${inc.riskLevel}` as Parameters<typeof tCommon>[0])}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatHKT(inc.detectedAt)}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
