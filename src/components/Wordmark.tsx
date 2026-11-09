import Image from "next/image";
import wordmark from "../../public/brand/coinlens-wordmark.png";

type Props = {
  /** Height of the drawn word in px. */
  size?: number;
  /** Line under the name. Pass `null` to hide it. */
  tagline?: string | null;
  className?: string;
};

export const TAGLINE = "Know what you're holding.";

/**
 * The CoinLens logo: the drawn wordmark (public/brand/coinlens-wordmark.png,
 * "Coin" in cream and "Lens" in verdigris), standing alone, with the tagline in live text.
 */
export default function Wordmark({ size = 28, tagline = TAGLINE, className }: Props) {
  const width = Math.round((size * wordmark.width) / wordmark.height);
  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      <Image
        src={wordmark}
        alt="CoinLens"
        width={width}
        height={size}
        priority
        className="block h-auto select-none"
        style={{ width }}
      />
      {tagline && <p className="mt-1 text-[11px] font-medium leading-snug text-cream-500">{tagline}</p>}
    </div>
  );
}
