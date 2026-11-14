export const mapKeys = {
  all: ["map"] as const,
};

// Points are [id, x, y, cluster, channel index, title, date], x and y in 0..1.
export type MapPoint = [string, number, number, number, number, string, string];

export interface MapCluster {
  id: number;
  label: string;
  size: number;
  x: number;
  y: number;
}

export interface MapData {
  model: string;
  built_at: string;
  channels: string[];
  clusters: MapCluster[];
  points: MapPoint[];
}
