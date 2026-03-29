import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNavbar } from "@/components/layout/top-navbar";
import { CriticalAlertPopup } from "@/components/critical-alert-popup";

export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/signin");

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopNavbar name={user.name} email={user.email} role={user.role} />
        <main className="flex-1 p-6">{children}</main>
      </div>
      {/* Polls every 10 s and shows a blocking modal for critical safety events */}
      <CriticalAlertPopup />
    </div>
  );
}
