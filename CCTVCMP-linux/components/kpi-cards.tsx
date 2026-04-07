import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

type KpiCardsProps = {
  edgeOnline: number;
  edgeTotal: number;
  openIncidents: number;
  highCriticalRisk: number;
  avgResponseTime: number;
};

export async function KpiCards({ edgeOnline, edgeTotal, openIncidents, highCriticalRisk, avgResponseTime }: KpiCardsProps) {
  const t = await getTranslations("dashboard");
  const cards = [
    { title: t("edgeDevicesOnline"), value: `${edgeOnline} / ${edgeTotal}`, href: null },
    {
      title: t("openIncidents"),
      value: openIncidents.toString(),
      href: openIncidents > 0 ? "/incidents?status=open" : null,
    },
    {
      title: t("highCriticalRisk"),
      value: highCriticalRisk.toString(),
      href: highCriticalRisk > 0 ? "/incidents?riskLevel=high,critical" : null,
    },
    { title: t("avgResponseTime"), value: `${Math.round(avgResponseTime)}m`, href: null },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className={card.href ? "transition-colors hover:bg-muted/50" : ""}>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{card.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {card.href ? (
              <Link href={card.href} className="block">
                <p className="text-3xl font-semibold text-primary underline-offset-4 hover:underline">
                  {card.value}
                </p>
              </Link>
            ) : (
              <p className="text-3xl font-semibold">{card.value}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
