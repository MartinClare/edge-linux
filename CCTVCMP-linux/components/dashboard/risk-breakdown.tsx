import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";

type CategoryRisk = {
  category: string;
  icon: string;
  openCount: number;
  latestRisk: string | null;
  latestSummary: string | null;
};

export async function RiskBreakdown({ categories }: { categories: CategoryRisk[] }) {
  const t = await getTranslations("dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("riskByCategory")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => (
            <div key={cat.category} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span>{cat.icon}</span>
                  <span className="font-medium text-sm">{cat.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  {cat.openCount > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {t("openBadge", { count: cat.openCount })}
                    </Badge>
                  )}
                  {cat.latestRisk && (
                    <Badge
                      variant={
                        cat.latestRisk === "high" || cat.latestRisk === "critical"
                          ? "destructive"
                          : cat.latestRisk === "medium"
                          ? "default"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {cat.latestRisk}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {cat.latestSummary ?? t("noRecentReports")}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
