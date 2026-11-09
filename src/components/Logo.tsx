import { useId } from "react";

type Props = { size?: number; className?: string };

/**
 * CoinLens mark: a reeded brass coin with a verdigris loupe lens at its centre
 * and a four-tick reticle. Brass = the coin, green = the looking.
 */
export default function Logo({ size = 40, className }: Props) {
  // Unique gradient ids so several logos on one page do not share defs.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const brass = `brass-${uid}`;
  const lens = `lens-${uid}`;
  const shine = `shine-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={brass} x1="10" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f3e1b0" />
          <stop offset="0.5" stopColor="#d4a84b" />
          <stop offset="1" stopColor="#8f6619" />
        </linearGradient>
        <radialGradient id={lens} cx="26" cy="26" r="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2fb59a" />
          <stop offset="0.55" stopColor="#145a4e" />
          <stop offset="1" stopColor="#0b2b26" />
        </radialGradient>
        <radialGradient id={shine} cx="22" cy="16" r="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Coin body */}
      <circle cx="32" cy="32" r="30" fill={`url(#${brass})`} />
      <circle cx="32" cy="32" r="30" fill={`url(#${shine})`} />
      {/* Reeded edge */}
      <circle cx="32" cy="32" r="28" stroke="#3a2805" strokeOpacity="0.55" strokeWidth="2.6" strokeDasharray="1.3 2.1" />
      {/* Field */}
      <circle cx="32" cy="32" r="23" fill="#0c0a08" />
      {/* Lens */}
      <circle cx="32" cy="32" r="15.5" fill={`url(#${lens})`} />
      <circle cx="32" cy="32" r="15.5" stroke="#4fd1b5" strokeWidth="1.8" />
      <path d="M22.5 27.5a10.5 10.5 0 0 1 7.2-6.3" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
      {/* Reticle ticks */}
      <g stroke="#f3ede1" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.9">
        <path d="M32 10.5v4.5" />
        <path d="M32 49v4.5" />
        <path d="M10.5 32h4.5" />
        <path d="M49 32h4.5" />
      </g>
      <circle cx="32" cy="32" r="2.2" fill="#bff0e4" />
    </svg>
  );
}
