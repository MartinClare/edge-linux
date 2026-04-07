import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { LocaleToggle } from "@/components/layout/locale-toggle";

export async function TopNavbar({ name, email, role }: { name: string; email: string; role: Role }) {
  const t = await getTranslations("nav");

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div>
        <p className="text-sm text-muted-foreground">{t("platform")}</p>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
      </div>
      <div className="flex items-center gap-3">
        <LocaleToggle />
        <div className="text-right">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email} · {role.replace("_", " ")}</p>
        </div>
        <form action="/api/auth/signout" method="post">
          <Button variant="outline" size="sm" type="submit">{t("signOut")}</Button>
        </form>
      </div>
    </header>
  );
}
