"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirmed = searchParams.get("confirmed") === "true";
  const confirmError = searchParams.get("error") === "confirmation_failed";
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [username, setUsername] = useState("");
  const [loginId, setLoginId] = useState("");   // email or username for signin
  const [email, setEmail] = useState("");        // email for signup / reset
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = () => {
    setUsername(""); setLoginId(""); setEmail(""); setPassword("");
    setError(null); setSuccess(null);
  };

  const switchMode = (next: "signin" | "signup" | "reset") => {
    setMode(next);
    resetForm();
  };

  const resolveEmail = async (id: string): Promise<string | null> => {
    if (id.includes("@")) return id;
    const res = await fetch("/api/auth/lookup-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: id }),
    });
    if (!res.ok) return null;
    const { email: found } = await res.json() as { email: string };
    return found ?? null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();

    if (mode === "signin") {
      const resolvedEmail = await resolveEmail(loginId.trim());
      if (!resolvedEmail) {
        setError("No account found with that username or email.");
        setLoading(false);
        return;
      }
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else if (mode === "signup") {
      if (!email.toLowerCase().endsWith("@roboco-op.org")) {
        setError("Sign up is restricted to @roboco-op.org email addresses.");
        setLoading(false);
        return;
      }
      const slug = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (slug.length < 3) {
        setError("Username must be at least 3 characters (letters, numbers, underscores).");
        setLoading(false);
        return;
      }
      const { data: signUpData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: slug },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else if (signUpData.user && signUpData.user.identities?.length === 0) {
        setError("This email is already registered. Please sign in instead.");
        setLoading(false);
      } else {
        setSuccess("Check your email for a confirmation link to activate your account.");
        setLoading(false);
      }
    } else {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (authError) {
        setError(authError.message);
      } else {
        setSuccess("Password reset email sent! Check your inbox.");
      }
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20";

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2d6a4f] mb-4">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">SDC Invoice Tool</h1>
          <p className="mt-1 text-sm text-stone-500">
            {mode === "signin" ? "Sign in to your account" : mode === "signup" ? "Create a new account" : "Reset your password"}
          </p>
        </div>

        {confirmed && (
          <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            ✓ Email confirmed! You can now sign in.
          </div>
        )}
        {confirmError && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Confirmation link is invalid or expired. Please try signing up again.
          </div>
        )}

        {/* Tab toggle */}
        {mode !== "reset" && (
          <div className="mb-4 flex rounded-xl bg-stone-100 p-1">
            <button type="button" onClick={() => switchMode("signin")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${mode === "signin" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
              Sign in
            </button>
            <button type="button" onClick={() => switchMode("signup")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${mode === "signup" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
              Sign up
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 space-y-5">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{success}</div>
          )}

          {/* Sign up fields */}
          {mode === "signup" && (
            <>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-stone-700" htmlFor="username">Username</label>
                <input id="username" type="text" autoComplete="username" required value={username}
                  onChange={(e) => setUsername(e.target.value)} className={inputClass}
                  placeholder="e.g. mido (letters, numbers, _)" />
              </div>
            </>
          )}

          {/* Signin: email or username. Signup/reset: email only */}
          {mode === "signin" ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="loginId">
                Username or email address
              </label>
              <input id="loginId" type="text" autoComplete="username" required value={loginId}
                onChange={(e) => setLoginId(e.target.value)} className={inputClass}
                placeholder="username or email@example.com" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="Email address" />
            </div>
          )}

          {mode !== "reset" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-stone-700" htmlFor="password">Password</label>
                {mode === "signin" && (
                  <button type="button" onClick={() => switchMode("reset")}
                    className="text-xs text-[#2d6a4f] hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <input id="password" type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="••••••••" />
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed">
            {loading
              ? mode === "signin" ? "Signing in…" : mode === "signup" ? "Creating account…" : "Sending…"
              : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>

          {mode === "reset" && (
            <button type="button" onClick={() => switchMode("signin")}
              className="w-full text-center text-sm text-stone-500 hover:text-stone-700">
              ← Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
