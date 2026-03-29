"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError(null);

    const payload: Record<string, string> = {
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
    };
    if (mode === "signup") payload.name = String(formData.get("name") || "");

    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Authentication failed" }));
      setError(data.message || "Authentication failed");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle>{mode === "signin" ? "Sign in" : "Sign up"}</CardTitle></CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {mode === "signup" && <Input name="name" placeholder="Full name" required />}
          <Input type="email" name="email" placeholder="Email" required />
          <Input type="password" name="password" placeholder="Password" required />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">{loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
