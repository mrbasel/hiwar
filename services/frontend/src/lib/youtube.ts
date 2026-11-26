export function videoId(url: string, fallback: string): string {
  return new URL(url).searchParams.get("v") ?? fallback;
}
