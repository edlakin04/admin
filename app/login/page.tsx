"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const expired      = searchParams.get("expired") === "1";
  const from         = searchParams.get("from") ?? "/";

  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(
    expired ? "Session expired — please log in again." : null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res  = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error ?? "Invalid password");
        return;
      }

      router.replace(from);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight:      "100vh",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      background:     "#0a0a0a",
      padding:        "24px",
    }}>
      <div style={{
        width:        "100%",
        maxWidth:     "360px",
        background:   "#111111",
        border:       "1px solid #27272a",
        borderRadius: "16px",
        padding:      "32px",
      }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>
          Admin
        </h1>
        <p style={{ color: "#71717a", fontSize: "13px", marginBottom: "24px" }}>
          Enter your password to continue.
        </p>

        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            style={{
              width:        "100%",
              background:   "#18181b",
              border:       "1px solid #3f3f46",
              borderRadius: "10px",
              padding:      "10px 12px",
              color:        "#e4e4e7",
              outline:      "none",
              marginBottom: "12px",
            }}
          />

          {error && (
            <p style={{
              color:        "#f87171",
              fontSize:     "13px",
              marginBottom: "12px",
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              width:        "100%",
              background:   loading ? "#3f3f46" : "#ffffff",
              color:        loading ? "#a1a1aa" : "#000000",
              border:       "none",
              borderRadius: "10px",
              padding:      "10px 16px",
              fontWeight:   600,
              fontSize:     "14px",
              cursor:       loading ? "not-allowed" : "pointer",
              transition:   "background 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
