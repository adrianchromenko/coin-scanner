"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from "firebase/auth";
import { firebase } from "@/lib/firebase/client";
import { log } from "@/lib/log";

type Props = { reason?: string; onClose: () => void };
type Mode = "signin" | "signup" | "reset";

/** Turn Firebase auth error codes into something a seller can act on. */
function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "There's already an account with that email. Sign in instead.";
    case "auth/weak-password":
      return "Use a password of at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/unauthorized-domain":
      return "This site's address isn't authorised in Firebase yet (Authentication → Settings → Authorized domains).";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't switched on in Firebase yet (Authentication → Sign-in method).";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    default:
      return (e as Error)?.message ?? "Something went wrong. Try again.";
  }
}

export default function SignInSheet({ reason, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function google() {
    setBusy("google");
    setError(null);
    const { auth } = firebase();
    const provider = new GoogleAuthProvider();
    try {
      log.info("auth", "Google sign-in: opening popup");
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "auth/popup-blocked") {
        log.warn("auth", "Popup blocked; falling back to redirect");
        await signInWithRedirect(auth, provider);
        return;
      }
      log.warn("auth", `Google sign-in failed (${code ?? "unknown"})`, e);
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy("email");
    setError(null);
    setNotice(null);
    const { auth } = firebase();
    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email.trim());
        log.info("auth", "Password reset email sent");
        setNotice("Check your inbox for a reset link.");
        setMode("signin");
      } else if (mode === "signup") {
        log.info("auth", "Creating email account");
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        log.info("auth", "Email sign-in");
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      log.warn("auth", `${mode} failed (${code ?? "unknown"})`, e);
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Welcome back";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
    >
      <div
        className="card w-full max-w-md animate-fade-up rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold leading-tight">{title}</h2>
              <p className="mt-0.5 text-xs text-cream-500">
                {reason ?? "Keep every coin you scan in one place."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost rounded-full px-3 py-1 text-xs"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        {mode !== "reset" && (
          <>
            <button
              type="button"
              onClick={google}
              disabled={busy !== null}
              className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow transition hover:bg-zinc-100 disabled:opacity-60"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
                <path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              {busy === "google" ? "Opening Google…" : "Continue with Google"}
            </button>
            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-cream-500">
              <span className="h-px flex-1 bg-white/10" />
              or with email
              <span className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <input
              type="text"
              autoComplete="name"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-dark"
            />
          )}
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-dark"
          />
          {mode !== "reset" && (
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "Choose a password (6+ characters)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-dark"
            />
          )}
          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
          )}
          {notice && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {notice}
            </p>
          )}
          <button
            type="submit"
            disabled={busy !== null}
            className="btn-primary mt-1 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
          >
            {busy === "email"
              ? "One moment…"
              : mode === "signup"
                ? "Create account"
                : mode === "reset"
                  ? "Send reset link"
                  : "Sign in"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs text-cream-500">
          {mode === "signin" && (
            <>
              <button type="button" className="hover:text-cream-100" onClick={() => setMode("reset")}>
                Forgot password?
              </button>
              <button type="button" className="hover:text-cream-100" onClick={() => setMode("signup")}>
                New here? <span className="text-patina-300">Create an account</span>
              </button>
            </>
          )}
          {mode === "signup" && (
            <button type="button" className="ml-auto hover:text-cream-100" onClick={() => setMode("signin")}>
              Already have an account? <span className="text-patina-300">Sign in</span>
            </button>
          )}
          {mode === "reset" && (
            <button type="button" className="ml-auto hover:text-cream-100" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
