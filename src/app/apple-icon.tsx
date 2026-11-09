import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon (Safari ignores SVG icons for "Add to Home Screen"). Same mark as Logo.tsx. */
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
          background: "radial-gradient(circle at 20% 0%, #1a2a26 0%, #0c0a08 55%)",
        }}
      >
        {/* Coin body */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 138,
            height: 138,
            borderRadius: 9999,
            background: "linear-gradient(135deg, #f3e1b0 0%, #d4a84b 50%, #8f6619 100%)",
          }}
        >
          {/* Reeded edge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 126,
              height: 126,
              borderRadius: 9999,
              border: "5px dashed rgba(58,40,5,0.55)",
            }}
          >
            {/* Field */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 104,
                height: 104,
                borderRadius: 9999,
                background: "#0c0a08",
              }}
            >
              {/* Lens */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 70,
                  height: 70,
                  borderRadius: 9999,
                  border: "4px solid #4fd1b5",
                  background: "radial-gradient(circle at 35% 30%, #2fb59a 0%, #145a4e 55%, #0b2b26 100%)",
                }}
              >
                <div style={{ display: "flex", width: 10, height: 10, borderRadius: 9999, background: "#bff0e4" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
