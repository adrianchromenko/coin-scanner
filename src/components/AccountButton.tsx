"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

/** Header control: "Sign in" when logged out, an avatar with a small menu when logged in. */
export default function AccountButton() {
  const { enabled, user, loading, openSignIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!enabled) return null;
  if (loading) return <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" aria-hidden="true" />;

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openSignIn()}
        className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium"
      >
        Sign in
      </button>
    );
  }

  const label = user.displayName || user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase();

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-patina-400/50 bg-ink-700 text-sm font-semibold text-gold-200 shadow-[0_0_0_3px_rgba(79,209,181,0.12)]"
      >
        {user.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="card absolute right-0 top-11 z-50 w-56 animate-fade-up overflow-hidden rounded-2xl p-1.5 shadow-2xl"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-cream-100">{label}</p>
            {user.displayName && user.email && (
              <p className="truncate text-xs text-cream-500">{user.email}</p>
            )}
          </div>
          <Link
            href="/coins"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-cream-100 hover:bg-white/5"
          >
            My coins
          </Link>
          <Link
            href="/"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-cream-100 hover:bg-white/5"
          >
            Scan a coin
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cream-300 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
