import { ImageResponse } from "next/og";

export const alt = "CoinLens — snap both sides of a coin, get an eBay-ready listing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share-preview card for iMessage, WhatsApp, Facebook, X, Slack, etc. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "linear-gradient(135deg, #0a0e18 0%, #111827 60%, #0a0e18 100%)",
          color: "#f6efe0",
          fontFamily: "Georgia, 'Times New Roman', serif",
          padding: "0 80px",
        }}
      >
        {/* Coin mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 300,
            height: 300,
            borderRadius: 9999,
            background: "radial-gradient(circle at 35% 30%, #ffe9a6 0%, #ecc14f 45%, #a8781c 100%)",
            boxShadow: "0 0 0 14px rgba(236,193,79,0.18), 0 40px 90px -30px rgba(236,193,79,0.7)",
            marginRight: 80,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 232,
              height: 232,
              borderRadius: 9999,
              border: "6px solid rgba(90,60,10,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 120,
                height: 120,
                borderRadius: 9999,
                border: "14px solid #0a0e18",
                background: "rgba(10,14,24,0.08)",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 108, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }}>
            <span style={{ color: "#ecc14f" }}>Coin</span>
            <span>Lens</span>
          </div>
          <div style={{ marginTop: 22, fontSize: 40, lineHeight: 1.25, color: "#e8dfc8", maxWidth: 640 }}>
            Two photos. One ready-to-post eBay listing.
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: 26,
              color: "#a39b88",
              fontFamily: "Helvetica, Arial, sans-serif",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Identify · Grade · Price · List
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
