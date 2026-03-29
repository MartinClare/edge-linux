import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="space-y-4">
        <AuthForm mode="signup" />
        <p className="text-center text-sm text-muted-foreground">Already have an account? <Link href="/signin" className="text-primary">Sign in</Link></p>
      </div>
    </div>
  );
}
