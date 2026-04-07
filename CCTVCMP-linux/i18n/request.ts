import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

const SUPPORTED_LOCALES = ["en", "zh"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function resolveLocale(raw: string | undefined): Locale {
  return SUPPORTED_LOCALES.includes(raw as Locale) ? (raw as Locale) : "en";
}

export default getRequestConfig(async () => {
  const locale = resolveLocale(cookies().get("cmp-locale")?.value);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
