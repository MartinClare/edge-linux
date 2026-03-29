import { prisma } from "@/lib/prisma";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ensureDefaultRules } from "@/lib/alarm-engine";

export default async function SettingsPage() {
  await ensureDefaultRules();

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
      <h2 className="text-2xl font-semibold">Settings</h2>
      <SettingsTabs rules={serializedRules} channels={serializedChannels} />
    </div>
  );
}
