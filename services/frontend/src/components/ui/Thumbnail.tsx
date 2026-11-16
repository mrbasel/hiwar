import { useState } from "react";
import { cn } from "#lib/format";

const SIZES = { mq: [320, 180], hq: [480, 360], maxres: [1280, 720] } as const;

// A YouTube video's still, cropped to 16:9. Larger stills don't exist for
// every video, so they fall back to the medium one before giving up.
export function Thumbnail({
  videoId,
  alt,
  quality = "mq",
  className,
}: {
  videoId: string;
  alt: string;
  quality?: keyof typeof SIZES;
  className?: string;
}) {
  const [current, setCurrent] = useState<keyof typeof SIZES | null>(quality);
  if (!current) return null;
  const [width, height] = SIZES[current];
  return (
    <img
      src={`https://i.ytimg.com/vi/${videoId}/${current}default.jpg`}
      alt={alt}
      loading="lazy"
      width={width}
      height={height}
      onError={() => setCurrent(current === "mq" ? null : "mq")}
      className={cn("aspect-video w-full bg-sunken object-cover", className)}
    />
  );
}

export function videoId(url: string, fallback: string): string {
  return new URL(url).searchParams.get("v") ?? fallback;
}
