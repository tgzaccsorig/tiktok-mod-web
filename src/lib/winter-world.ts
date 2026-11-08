export type WinterWeatherKey = "snowfall" | "aurora" | "frost" | "clear" | "blizzard";
export type WinterEventKey = "snowflake_rush" | "aurora_night" | "frozen_gifts" | "snowman_parade";

export const WINTER_WEATHER: Record<WinterWeatherKey, { title: string; icon: string; description: string }> = {
  snowfall: { title: "Снегопад", icon: "🌨️", description: "Мягкий снег укрывает зимний город." },
  aurora: { title: "Северное сияние", icon: "🌌", description: "Небо озаряется зелёными и голубыми огнями." },
  frost: { title: "Морозный день", icon: "🧊", description: "Иней украсил крыши и деревья." },
  clear: { title: "Ясная погода", icon: "✨", description: "Над городом чистое зимнее небо." },
  blizzard: { title: "Метель", icon: "❄️", description: "Ветер кружит снежинки над площадью." },
};

export const WINTER_WORLD_EVENTS: Record<WinterEventKey, { title: string; description: string }> = {
  snowflake_rush: { title: "Час снежинок", description: "На площади начался сбор праздничных снежинок. Забери награду события." },
  aurora_night: { title: "Ночь авроры", description: "Северное сияние осветило город. Успей забрать подарок события." },
  frozen_gifts: { title: "Замёрзшие подарки", description: "На площади появились праздничные подарки. Один из них ждёт тебя." },
  snowman_parade: { title: "Парад снеговиков", description: "Снеговики вышли на главную улицу и приготовили небольшой подарок." },
};

export function clampContribution(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

export function worldGoalProgress(total: number, target: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.max(0, (total / target) * 100));
}
