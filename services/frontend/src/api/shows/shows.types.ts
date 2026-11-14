export const showKeys = {
  all: ["shows"] as const,
};

export interface Show {
  id: string;
  name: string;
  episodes: number;
}

export interface ShowsResponseItem extends Omit<Show, "id"> {
  id: string | number;
}
