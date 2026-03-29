import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="space-y-4">
        <AuthForm mode="signin" />
        <p className="text-center text-sm text-muted-foreground">No account? <Link href="/signup" className="text-primary">Create one</Link></p>
      </div>
    </div>
  );
}
