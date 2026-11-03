export type CategoryId = "memes" | "minecraft" | "animals" | "games" | "humor";

export const CATEGORIES: { id: CategoryId; label: string; keywords: string[] }[] = [
  { id: "memes", label: "Мемы", keywords: ["meme", "memes", "мем", "мемы", "dankmemes"] },
  { id: "minecraft", label: "Minecraft", keywords: ["minecraft", "майнкрафт", "майнкрафт"] },
  {
    id: "animals",
    label: "Животные",
    keywords: [
      "pet", "pets", "petsoftiktok", "dog", "dogs", "cat", "cats", "puppy", "kitten",
      "animal", "animals", "животные", "кот", "кошка", "собака", "щенок",
    ],
  },
  {
    id: "games",
    label: "Игры",
    keywords: ["game", "games", "gaming", "gamer", "gameplay", "roblox", "fortnite", "игры", "игра", "геймер"],
  },
  { id: "humor", label: "Юмор", keywords: ["funny", "comedy", "humor", "humour", "lol", "joke", "юмор", "смешно", "прикол"] },
];

export type FeedMode = "foryou" | "random" | "favorites" | "history" | CategoryId;

export type VideoItem = {
  id: string;
  url: string;
  author: string;
  authorUrl: string;
  title: string;
  hashtags: string[];
  music: string | null;
  thumbnail: string | null;
  categories: CategoryId[];
};

export type Slide = { key: string; item: VideoItem; cycle: number };

export type Store = {
  likes: string[];
  favs: string[];
  history: { id: string; ts: number }[];
  custom: string[];
  category: FeedMode;
  settings: { sound: boolean; autoNext: boolean };
};
