export type CategoryId = "memes" | "minecraft" | "animals" | "games" | "humor" | "music" | "technology" | "sports" | "entertainment" | "education" | "other";

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
  { id: "music", label: "Музыка", keywords: ["music", "song", "songs", "audio", "музыка", "песня", "песни", "трек"] },
  { id: "technology", label: "Технологии", keywords: ["tech", "technology", "ai", "coding", "software", "гаджет", "технологии", "программирование", "нейросеть"] },
  { id: "sports", label: "Спорт", keywords: ["sport", "sports", "football", "basketball", "fitness", "спорт", "футбол", "баскетбол", "тренировка"] },
  { id: "entertainment", label: "Развлечения", keywords: ["entertainment", "challenge", "dance", "развлечения", "танец", "танцы", "шоу"] },
  { id: "education", label: "Образование", keywords: ["education", "learn", "science", "study", "обучение", "учёба", "наука", "объяснение"] },
  { id: "other", label: "Другое", keywords: ["other", "другое", "прочее"] },
];

export type FeedMode = "foryou" | "random" | "favorites" | "history" | "subscriptions" | CategoryId;

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
  publishedAt?: string;
  ownerId?: string;
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
