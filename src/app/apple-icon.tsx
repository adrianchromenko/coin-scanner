import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon (Safari ignores SVG icons for "Add to Home Screen"). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e18",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 132,
            height: 132,
            borderRadius: 9999,
            background: "radial-gradient(circle at 35% 30%, #ffe9a6 0%, #ecc14f 45%, #a8781c 100%)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 102,
              height: 102,
              borderRadius: 9999,
              border: "3px solid rgba(90,60,10,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 52,
                height: 52,
                borderRadius: 9999,
                border: "7px solid #0a0e18",
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
