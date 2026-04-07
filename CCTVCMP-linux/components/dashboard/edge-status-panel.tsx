import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatHKT } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

type DeviceStatus = {
  id: string;
  name: string;
  edgeCameraId: string | null;
  streamUrl: string | null;
  isOnline: boolean;
  status: string;
  lastReportAt: string | null;
  latestRiskLevel: string | null;
  latestDescription: string | null;
};

export async function EdgeStatusPanel({ devices }: { devices: DeviceStatus[] }) {
  const t = await getTranslations("dashboard");

  if (devices.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">{t("edgeDevicesLabel")}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("noDevicesYet")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("edgeDeviceStatus")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <Link
              key={d.id}
              href={`/edge-devices/${d.id}`}
              className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      d.status === "maintenance"
                        ? "bg-yellow-400"
                        : d.isOnline
                        ? "bg-green-400 animate-pulse"
                        : "bg-red-400"
                    }`}
                  />
                  <span className="font-medium text-sm">{d.name}</span>
                </div>
                {d.latestRiskLevel && (
                  <Badge
                    variant={
                      d.latestRiskLevel === "High"
                        ? "destructive"
                        : d.latestRiskLevel === "Medium"
                        ? "default"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {d.latestRiskLevel}
                  </Badge>
                )}
              </div>
              {d.latestDescription && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                  {d.latestDescription}
                </p>
              )}
              {(d.edgeCameraId || d.streamUrl) && (
                <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1">
                  {d.edgeCameraId ?? "—"}
                  {d.streamUrl ? ` · ${d.streamUrl}` : ""}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {d.lastReportAt
                  ? t("lastReport", { time: formatHKT(d.lastReportAt) })
                  : t("noReportsYet")}
              </p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
