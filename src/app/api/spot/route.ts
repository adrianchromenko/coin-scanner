import { connection } from "next/server";
import { getAllSpots } from "@/lib/server/spot";

/** Current precious-metal spot prices (USD per troy oz), cached server-side for an hour. */
export async function GET() {
  await connection(); // live data, never prerendered
  const spots = await getAllSpots();
  return Response.json(
    { spots, fetched_at: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } },
  );
}
