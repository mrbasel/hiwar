// A YouTube link to a second in an episode.
export function link(url: string, seconds: number): string {
  return `${url}&t=${Math.floor(seconds)}s`;
}
