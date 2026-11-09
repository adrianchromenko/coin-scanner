import { ImageResponse } from "next/og";

export const alt = "CoinLens — know what you're holding. Snap both sides of a coin, get a priced eBay-ready listing.";
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
          background:
            "radial-gradient(60% 50% at 10% 0%, rgba(79,209,181,0.22) 0%, rgba(79,209,181,0) 70%), radial-gradient(50% 40% at 100% 100%, rgba(212,168,75,0.16) 0%, rgba(212,168,75,0) 70%), #0c0a08",
          color: "#f3ede1",
          fontFamily: "Helvetica, Arial, sans-serif",
          padding: "0 84px",
        }}
      >
        {/* Mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 320,
            height: 320,
            borderRadius: 9999,
            background: "linear-gradient(135deg, #f3e1b0 0%, #d4a84b 50%, #8f6619 100%)",
            boxShadow: "0 0 0 18px rgba(79,209,181,0.10), 0 50px 110px -40px rgba(79,209,181,0.6)",
            marginRight: 84,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 292,
              height: 292,
              borderRadius: 9999,
              border: "11px dashed rgba(58,40,5,0.55)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 240,
                height: 240,
                borderRadius: 9999,
                background: "#0c0a08",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 160,
                  height: 160,
                  borderRadius: 9999,
                  border: "9px solid #4fd1b5",
                  background: "radial-gradient(circle at 35% 30%, #2fb59a 0%, #145a4e 55%, #0b2b26 100%)",
                }}
              >
                <div style={{ display: "flex", width: 22, height: 22, borderRadius: 9999, background: "#bff0e4" }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 120, fontWeight: 800, letterSpacing: -6, lineHeight: 1 }}>
            <span>Coin</span>
            <span style={{ color: "#4fd1b5" }}>Lens</span>
          </div>
          <div style={{ marginTop: 26, fontSize: 42, lineHeight: 1.2, color: "#f3ede1", maxWidth: 640, fontWeight: 500 }}>
            Know what you&apos;re holding.
          </div>
          <div style={{ marginTop: 18, fontSize: 28, lineHeight: 1.35, color: "#d3cab8", maxWidth: 640 }}>
            Two photos. A graded, priced, ready-to-post eBay listing.
          </div>
          <div
            style={{
              marginTop: 36,
              fontSize: 22,
              color: "#9a917f",
              fontFamily: "Menlo, Consolas, monospace",
              letterSpacing: 5,
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
