import Image from "next/image";
import Logo from "./Logo";
import wordmark from "../../public/brand/coinlens-wordmark.png";

type Props = {
  /** Logo size in px; the type scales with it. */
  size?: number;
  /** Line under the name. Pass `null` to hide it. */
  tagline?: string | null;
  className?: string;
};

export const TAGLINE = "Know what you're holding.";

/**
 * CoinLens lock-up: mark + the drawn wordmark (public/brand/coinlens-wordmark.png,
 * "Coin" in cream and "Lens" in verdigris) with the tagline set in live text.
 */
export default function Wordmark({ size = 44, tagline = TAGLINE, className }: Props) {
  const wordHeight = Math.round(size * 0.6);
  const wordWidth = Math.round((wordHeight * wordmark.width) / wordmark.height);
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <Logo size={size} className="shrink-0 drop-shadow-[0_8px_20px_rgba(79,209,181,0.35)]" />
      <div className="min-w-0">
        <Image
          src={wordmark}
          alt="CoinLens"
          width={wordWidth}
          height={wordHeight}
          priority
          className="block h-auto select-none"
          style={{ width: wordWidth }}
        />
        {tagline && <p className="mt-1 text-[11px] font-medium leading-snug text-cream-500">{tagline}</p>}
      </div>
    </div>
  );
}
