import { prisma } from "@/lib/prisma";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ensureDefaultRules, migrateCriticalAlertRules } from "@/lib/alarm-engine";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  await ensureDefaultRules();
  // Self-heal: upgrade any rules still at old defaults to critical-alert standards
  await migrateCriticalAlertRules();

  const [rules, channels] = await Promise.all([
    prisma.alarmRule.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.notificationChannel.findMany({
      include: { _count: { select: { logs: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const serializedRules = rules.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const serializedChannels = channels.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">{t("title")}</h2>
      <SettingsTabs rules={serializedRules} channels={serializedChannels} />
    </div>
  );
}
