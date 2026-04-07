"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggle = async () => {
    const next = locale === "en" ? "zh" : "en";

    // Set cookie immediately so next-intl reads it on refresh
    document.cookie = `cmp-locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;

    // Persist to DB (fire-and-forget; UI already updates from cookie)
    fetch("/api/user/locale", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => { /* non-critical */ });

    startTransition(() => router.refresh());
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      title={locale === "en" ? "切换到中文" : "Switch to English"}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 min-w-[38px]"
    >
      {locale === "en" ? "中文" : "EN"}
    </button>
  );
}
