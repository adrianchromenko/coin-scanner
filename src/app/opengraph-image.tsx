import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "CoinLens — know what you're holding. Snap both sides of a coin, get a priced eBay-ready listing.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share-preview card for iMessage, WhatsApp, Facebook, X, Slack, etc. Uses the drawn wordmark and Poppins. */
export default async function Image() {
  const [medium, lockup] = await Promise.all([
    readFile(join(process.cwd(), "src/app/fonts/Poppins-Medium.ttf")),
    readFile(join(process.cwd(), "public/brand/coinlens-lockup.png")),
  ]);
  const wordmark = `data:image/png;base64,${lockup.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background:
            "radial-gradient(60% 50% at 10% 0%, rgba(79,209,181,0.22) 0%, rgba(79,209,181,0) 70%), radial-gradient(50% 40% at 100% 100%, rgba(212,168,75,0.16) 0%, rgba(212,168,75,0) 70%), #0c0a08",
          color: "#f3ede1",
          fontFamily: "Poppins",
          padding: "0 84px",
        }}
      >
        {/* Mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 300,
            height: 300,
            borderRadius: 9999,
            background: "linear-gradient(135deg, #f3e1b0 0%, #d4a84b 50%, #8f6619 100%)",
            boxShadow: "0 0 0 18px rgba(79,209,181,0.10), 0 50px 110px -40px rgba(79,209,181,0.6)",
            marginRight: 76,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 274,
              height: 274,
              borderRadius: 9999,
              border: "10px dashed rgba(58,40,5,0.55)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 226,
                height: 226,
                borderRadius: 9999,
                background: "#0c0a08",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 150,
                  height: 150,
                  borderRadius: 9999,
                  border: "9px solid #4fd1b5",
                  background: "radial-gradient(circle at 35% 30%, #2fb59a 0%, #145a4e 55%, #0b2b26 100%)",
                }}
              >
                <div style={{ display: "flex", width: 20, height: 20, borderRadius: 9999, background: "#bff0e4" }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Drawn wordmark: "CoinLens" + tagline, transparent PNG */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={wordmark} alt="" width={640} height={Math.round((640 * 332) / 1170)} style={{ display: "block" }} />
          <div style={{ marginTop: 26, fontSize: 28, lineHeight: 1.35, color: "#d3cab8", maxWidth: 640, fontWeight: 500 }}>
            Two photos. A graded, priced, ready-to-post eBay listing.
          </div>
          <div
            style={{
              marginTop: 30,
              fontSize: 20,
              color: "#9a917f",
              letterSpacing: 5,
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Identify · Grade · Price · List
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Poppins", data: medium, weight: 500, style: "normal" }],
    },
  );
}
