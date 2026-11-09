import Logo from "./Logo";

type Props = {
  /** Logo size in px; the type scales with it. */
  size?: number;
  /** Line under the name. Pass `null` to hide it. */
  tagline?: string | null;
  className?: string;
};

export const TAGLINE = "Know what you're holding.";

/** CoinLens lock-up: mark + name in the display face, "Lens" in verdigris. */
export default function Wordmark({ size = 44, tagline = TAGLINE, className }: Props) {
  const type = Math.round(size * 0.64);
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <Logo size={size} className="shrink-0 drop-shadow-[0_8px_20px_rgba(79,209,181,0.35)]" />
      <div className="min-w-0">
        <p
          className="font-display font-extrabold leading-none tracking-[-0.045em] text-cream-100"
          style={{ fontSize: type }}
        >
          Coin<span className="patina-text">Lens</span>
        </p>
        {tagline && <p className="mt-1 text-[11px] leading-snug text-cream-500">{tagline}</p>}
      </div>
    </div>
  );
}
