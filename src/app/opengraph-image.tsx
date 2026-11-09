import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "CoinLens — know what you're holding. Snap both sides of a coin, get a priced eBay-ready listing.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share-preview card for iMessage, WhatsApp, Facebook, X, Slack, etc.: the drawn wordmark, alone, in Poppins. */
export default async function Image() {
  const [medium, lockup] = await Promise.all([
    readFile(join(process.cwd(), "src/app/fonts/Poppins-Medium.ttf")),
    readFile(join(process.cwd(), "public/brand/coinlens-lockup.png")),
  ]);
  const wordmark = `data:image/png;base64,${lockup.toString("base64")}`;
  const w = 820;
  const h = Math.round((w * 332) / 1170);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(60% 50% at 10% 0%, rgba(79,209,181,0.22) 0%, rgba(79,209,181,0) 70%), radial-gradient(50% 40% at 100% 100%, rgba(212,168,75,0.16) 0%, rgba(212,168,75,0) 70%), #0c0a08",
          color: "#f3ede1",
          fontFamily: "Poppins",
          padding: "0 90px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wordmark} alt="" width={w} height={h} style={{ display: "block" }} />
        <div style={{ marginTop: 34, fontSize: 30, lineHeight: 1.3, color: "#d3cab8", textAlign: "center", fontWeight: 500 }}>
          Two photos. A graded, priced, ready-to-post eBay listing.
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 20,
            color: "#9a917f",
            letterSpacing: 6,
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Identify · Grade · Price · List
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Poppins", data: medium, weight: 500, style: "normal" }],
    },
  );
}
