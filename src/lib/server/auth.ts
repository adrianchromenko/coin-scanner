import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { slog } from "@/lib/serverLog";

/**
 * Server-side identity and usage control.
 *
 * Two modes:
 *  - FIREBASE_SERVICE_ACCOUNT set (JSON or base64 JSON of a service-account key):
 *    the Admin SDK verifies ID tokens offline and usage is counted in Firestore,
 *    so limits survive restarts and the admin dashboard has real data.
 *  - Not set: ID tokens are verified through the Identity Toolkit REST API with the
 *    public web API key, and usage is counted in memory (resets on each deploy /
 *    free-plan wake-up). Good enough to stop casual abuse.
 *
 * Policy env vars: REQUIRE_SIGN_IN=1 (scans need an account), DAILY_SCAN_LIMIT=N
 * (per user, or per IP for anonymous scans; 0 = unlimited), ADMIN_EMAILS=a@x.com,b@y.com
 * (exempt from limits; may open /admin).
 */

export type Verified = { uid: string; email: string | null; name: string | null; via: "admin" | "rest" };

export const REQUIRE_SIGN_IN = process.env.REQUIRE_SIGN_IN === "1";
export const DAILY_SCAN_LIMIT = Math.max(0, Number(process.env.DAILY_SCAN_LIMIT ?? 0) || 0);
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(user: Verified | null): boolean {
  return Boolean(user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));
}

// ---------- Admin SDK (optional) ----------

let adminApp: App | null | undefined;

function loadServiceAccount(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (e) {
    slog("error", "auth", "FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64 JSON", e);
    return null;
  }
}

function admin(): App | null {
  if (adminApp !== undefined) return adminApp;
  const sa = loadServiceAccount();
  if (!sa) {
    adminApp = null;
    return null;
  }
  adminApp = getApps()[0] ?? initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]), projectId: sa.project_id });
  slog("info", "auth", "Firebase Admin SDK ready", { project: sa.project_id });
  return adminApp;
}

export const adminConfigured = (): boolean => admin() !== null;

function db(): Firestore | null {
  const app = admin();
  return app ? getFirestore(app) : null;
}

// ---------- Token verification ----------

const tokenCache = new Map<string, { user: Verified; exp: number }>();

async function verifyViaRest(idToken: string): Promise<Verified | null> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { users?: { localId: string; email?: string; displayName?: string }[] };
  const u = j.users?.[0];
  return u ? { uid: u.localId, email: u.email ?? null, name: u.displayName ?? null, via: "rest" } : null;
}

/** Identify the caller from `Authorization: Bearer <Firebase ID token>`. Null when absent or invalid. */
export async function verifyBearer(req: Request): Promise<Verified | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  try {
    let user: Verified | null;
    const app = admin();
    if (app) {
      const d = await getAuth(app).verifyIdToken(token);
      user = { uid: d.uid, email: d.email ?? null, name: (d.name as string | undefined) ?? null, via: "admin" };
    } else {
      user = await verifyViaRest(token);
    }
    if (user) tokenCache.set(token, { user, exp: Date.now() + 5 * 60 * 1000 });
    if (tokenCache.size > 2000) tokenCache.clear();
    return user;
  } catch (e) {
    slog("warn", "auth", "ID token rejected", e);
    return null;
  }
}

// ---------- Usage counting ----------

export type ScanKind = "identify" | "revalue" | "locate";

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
};

/** Rough cost in USD for claude-opus-5-5 ($4 / $20 per MTok, cache reads $0.20, $10 per 1000 searches). */
export function estimateCost(usage: Usage | undefined | null): number {
  if (!usage) return 0;
  const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25;
  const cached = usage.cache_read_input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return +(inTok * 4e-6 + cached * 0.2e-6 + out * 20e-6 + searches * 0.01).toFixed(4);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** In-memory counters, always maintained (fallback when Firestore is not configured). */
const mem = {
  byDay: new Map<string, { count: number; cost_usd: number; keys: Map<string, number> }>(),
  recent: [] as ScanRecord[],
};

function dayBucket(date: string) {
  let b = mem.byDay.get(date);
  if (!b) {
    b = { count: 0, cost_usd: 0, keys: new Map() };
    mem.byDay.set(date, b);
    if (mem.byDay.size > 60) mem.byDay.delete([...mem.byDay.keys()].sort()[0]);
  }
  return b;
}

function safeKey(k: string) {
  return k.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0] : req.headers.get("x-real-ip") ?? "unknown").trim();
}

export function usageKey(user: Verified | null, req: Request): string {
  return user ? user.uid : `ip_${safeKey(clientIp(req))}`;
}

async function usageCount(key: string, date: string): Promise<number> {
  const store = db();
  if (store) {
    try {
      const snap = await store.doc(`usage_daily/${date}`).get();
      const n = snap.get(`keys.${safeKey(key)}`);
      return typeof n === "number" ? n : 0;
    } catch (e) {
      slog("warn", "usage", "Firestore usage read failed; using memory", e);
    }
  }
  return dayBucket(date).keys.get(key) ?? 0;
}

export type ScanRecord = {
  at: number;
  date: string;
  kind: ScanKind;
  key: string;
  uid: string | null;
  email: string | null;
  model: string | null;
  ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  searches: number;
  title?: string;
  ok: boolean;
};

/** Record one model call for limits and the admin dashboard. Never throws. */
export async function recordScan(
  req: Request,
  user: Verified | null,
  info: { kind: ScanKind; model: string | null; usage?: Usage | null; ms: number; title?: string; ok: boolean },
): Promise<void> {
  const date = today();
  const key = usageKey(user, req);
  const rec: ScanRecord = {
    at: Date.now(),
    date,
    kind: info.kind,
    key,
    uid: user?.uid ?? null,
    email: user?.email ?? null,
    model: info.model,
    ms: info.ms,
    cost_usd: estimateCost(info.usage),
    input_tokens: info.usage?.input_tokens ?? 0,
    output_tokens: info.usage?.output_tokens ?? 0,
    searches: info.usage?.server_tool_use?.web_search_requests ?? 0,
    title: info.title,
    ok: info.ok,
  };
  const b = dayBucket(date);
  b.count += 1;
  b.cost_usd += rec.cost_usd;
  b.keys.set(key, (b.keys.get(key) ?? 0) + 1);
  mem.recent.unshift(rec);
  if (mem.recent.length > 200) mem.recent.length = 200;

  const store = db();
  if (!store) return;
  try {
    const batch = store.batch();
    batch.set(store.collection("scans").doc(), rec);
    batch.set(
      store.doc(`usage_daily/${date}`),
      {
        date,
        count: FieldValue.increment(1),
        cost_usd: FieldValue.increment(rec.cost_usd),
        [`keys.${safeKey(key)}`]: FieldValue.increment(1),
        [`emails.${safeKey(key)}`]: rec.email ?? "anonymous",
      },
      { merge: true },
    );
    if (user) {
      batch.set(
        store.doc(`users/${user.uid}/usage/${date}`),
        { count: FieldValue.increment(1), cost_usd: FieldValue.increment(rec.cost_usd) },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (e) {
    slog("warn", "usage", "Firestore usage write failed", e);
  }
}

export type Gate =
  | { ok: true; user: Verified | null; remaining: number | null }
  | { ok: false; response: Response };

/** Apply the sign-in and daily-limit policy to a scan request. */
export async function gateScan(req: Request, step: string): Promise<Gate> {
  const user = await verifyBearer(req);
  if (REQUIRE_SIGN_IN && !user) {
    slog("warn", step, "Rejected: sign-in required");
    return {
      ok: false,
      response: Response.json(
        { error: "Sign in to scan coins. It's free.", code: "sign_in_required" },
        { status: 401 },
      ),
    };
  }
  if (DAILY_SCAN_LIMIT > 0 && !isAdmin(user)) {
    const key = usageKey(user, req);
    const used = await usageCount(key, today());
    if (used >= DAILY_SCAN_LIMIT) {
      slog("warn", step, "Rejected: daily limit reached", { key, used, limit: DAILY_SCAN_LIMIT });
      return {
        ok: false,
        response: Response.json(
          {
            error: user
              ? `You've used today's ${DAILY_SCAN_LIMIT} scans. Come back tomorrow.`
              : `Today's free scans are used up on this connection. Sign in for your own daily allowance.`,
            code: "limit_reached",
            remaining: 0,
          },
          { status: 429 },
        ),
      };
    }
    return { ok: true, user, remaining: DAILY_SCAN_LIMIT - used - 1 };
  }
  return { ok: true, user, remaining: null };
}

// ---------- Admin dashboard data ----------

export type UsageReport = {
  source: "firestore" | "memory";
  policy: { require_sign_in: boolean; daily_limit: number; admin_configured: boolean };
  days: { date: string; count: number; cost_usd: number }[];
  top: { key: string; email: string | null; count: number }[];
  recent: ScanRecord[];
};

export async function usageReport(days = 14): Promise<UsageReport> {
  const policy = { require_sign_in: REQUIRE_SIGN_IN, daily_limit: DAILY_SCAN_LIMIT, admin_configured: adminConfigured() };
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  const store = db();
  if (store) {
    try {
      const [daySnaps, recentSnap] = await Promise.all([
        store.getAll(...dates.map((d) => store.doc(`usage_daily/${d}`))),
        store.collection("scans").orderBy("at", "desc").limit(50).get(),
      ]);
      const totals = new Map<string, { count: number; email: string | null }>();
      const out = daySnaps.map((s, i) => {
        const keys = (s.get("keys") as Record<string, number> | undefined) ?? {};
        const emails = (s.get("emails") as Record<string, string> | undefined) ?? {};
        for (const [k, n] of Object.entries(keys)) {
          const t = totals.get(k) ?? { count: 0, email: emails[k] ?? null };
          t.count += n;
          totals.set(k, t);
        }
        return { date: dates[i], count: (s.get("count") as number) ?? 0, cost_usd: +((s.get("cost_usd") as number) ?? 0).toFixed(2) };
      });
      return {
        source: "firestore",
        policy,
        days: out,
        top: [...totals.entries()]
          .map(([key, t]) => ({ key, email: t.email === "anonymous" ? null : t.email, count: t.count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        recent: recentSnap.docs.map((d) => d.data() as ScanRecord),
      };
    } catch (e) {
      slog("warn", "usage", "Firestore report failed; using memory", e);
    }
  }
  const totals = new Map<string, number>();
  for (const d of dates) for (const [k, n] of dayBucket(d).keys) totals.set(k, (totals.get(k) ?? 0) + n);
  const emailOf = (k: string) => mem.recent.find((r) => r.key === k)?.email ?? null;
  return {
    source: "memory",
    policy,
    days: dates.map((d) => {
      const b = mem.byDay.get(d);
      return { date: d, count: b?.count ?? 0, cost_usd: +(b?.cost_usd ?? 0).toFixed(2) };
    }),
    top: [...totals.entries()]
      .map(([key, count]) => ({ key, email: emailOf(key), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    recent: mem.recent.slice(0, 50),
  };
}
