import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";

export function TopNavbar({ name, email, role }: { name: string; email: string; role: Role }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div>
        <p className="text-sm text-muted-foreground">Central Monitoring Platform</p>
        <h1 className="text-lg font-semibold">AXON Vision</h1>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email} ? {role.replace("_", " ")}</p>
        </div>
        <form action="/api/auth/signout" method="post">
          <Button variant="outline" size="sm" type="submit">Sign out</Button>
        </form>
      </div>
    </header>
  );
}
