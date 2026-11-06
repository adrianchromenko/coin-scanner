type Props = { size?: number; className?: string };

/** CoinLens mark: a gold coin with a lens at its centre. */
export default function Logo({ size = 40, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="cl-gold" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbe9b0" />
          <stop offset="0.45" stopColor="#ecc14f" />
          <stop offset="1" stopColor="#b0821a" />
        </linearGradient>
        <radialGradient id="cl-shine" cx="22" cy="18" r="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#cl-gold)" />
      <circle cx="32" cy="32" r="30" fill="url(#cl-shine)" />
      <circle
        cx="32"
        cy="32"
        r="26.5"
        stroke="#7d5a0e"
        strokeOpacity="0.6"
        strokeWidth="1.6"
        strokeDasharray="2.2 2.3"
      />
      <circle cx="32" cy="32" r="21" fill="#0a0e18" />
      <circle cx="32" cy="32" r="12.5" stroke="url(#cl-gold)" strokeWidth="5" />
      <circle cx="32" cy="32" r="5" fill="url(#cl-gold)" />
      <path
        d="M37.5 24.2a9.5 9.5 0 0 1 4.6 5.3"
        stroke="#ffffff"
        strokeOpacity="0.75"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
