import { ADMIN_EMAILS, isAdmin, usageReport, verifyBearer } from "@/lib/server/auth";
import { requestId, slog } from "@/lib/serverLog";

/** Usage dashboard data. Only for signed-in users whose email is in ADMIN_EMAILS. */
export async function GET(req: Request) {
  const rid = requestId();
  const step = `admin#${rid}`;
  if (ADMIN_EMAILS.length === 0) {
    return Response.json({ error: "No admins configured. Set ADMIN_EMAILS on the server.", code: "not_configured" }, { status: 503 });
  }
  const user = await verifyBearer(req);
  if (!user) return Response.json({ error: "Sign in first.", code: "unauthenticated" }, { status: 401 });
  if (!isAdmin(user)) {
    slog("warn", step, "Non-admin tried to open the dashboard", { email: user.email });
    return Response.json({ error: "This account is not an admin.", code: "forbidden" }, { status: 403 });
  }
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 14) || 14));
  const report = await usageReport(days);
  slog("info", step, "Usage report served", { to: user.email, days, source: report.source });
  return Response.json(report);
}
