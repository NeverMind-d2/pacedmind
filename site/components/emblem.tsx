// Imported rather than linked, so its URL carries a content hash and can be cached for good.
import emblem from "@/public/brand/emblem.svg";

/** The pd emblem. */
export function Emblem({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimizer
  return <img src={emblem.src} width={size} height={size} alt="" />;
}
