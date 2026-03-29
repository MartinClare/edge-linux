import { AuthForm } from "@/components/auth/auth-form";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="space-y-4">
        <AuthForm />
        <p className="text-center text-sm text-muted-foreground max-w-md">
          Accounts are assigned by your administrator. Use the email and password you were given.
        </p>
      </div>
    </div>
  );
}
