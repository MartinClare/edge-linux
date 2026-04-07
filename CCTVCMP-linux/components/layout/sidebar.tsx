"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, FileText, LayoutDashboard, Radio, ShieldAlert, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const navItems = [
    { href: "/dashboard",    label: t("dashboard"),    icon: LayoutDashboard },
    { href: "/edge-devices", label: t("edgeDevices"),  icon: Radio },
    { href: "/incidents",    label: t("incidents"),    icon: ShieldAlert },
    { href: "/analytics",    label: t("analytics"),    icon: BarChart3 },
    { href: "/reports",      label: t("reports"),      icon: FileText },
    { href: "/settings",     label: t("settings"),     icon: Settings },
  ];

  return (
    <aside className="hidden w-64 border-r border-border bg-card lg:block">
      <div className="p-6 text-xl font-semibold">{t("title")}</div>
      <nav className="space-y-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
