import Link from "next/link";

const updates = [
  {
    version: "2.0.0",
    date: "06.11.2026",
    title: "Начало новой эры TikTok Mod Web",
    changes: [
      "Начата разработка поколения 2.0 в отдельной ветке, без изменения основной версии сайта.",
      "Добавлены комментарии к роликам с загрузкой, отправкой и удалением собственных комментариев.",
      "Комментарии доступны для чтения всем посетителям; для публикации требуется вход в аккаунт.",
      "Добавлена защита комментариев через Supabase Row Level Security и ограничение длины до 1000 символов.",
    ],
  },
  {
    version: "1.0.5",
    date: "06.11.2026",
    title: "Исправлена прокрутка журнала обновлений",
    changes: [
      "Страница Update Log получила собственную вертикальную прокрутку, не зависящую от заблокированной прокрутки основной видеоленты.",
      "Сохранена вся история предыдущих обновлений.",
      "Улучшена поддержка прокрутки на сенсорных устройствах.",
    ],
  },
  {
    version: "1.0.4",
    date: "06.11.2026",
    title: "Исправлена пустая лента",
    changes: [
      "Убран строгий языковой фильтр, который мог скрыть все ролики.",
      "Русскоязычные ролики теперь идут первыми, остальные доступные видео остаются в ленте.",
      "Новые найденные ролики также добавляются с приоритетом русского языка.",
    ],
  },
  {
    version: "1.0.3",
    date: "06.11.2026",
    title: "Приоритет русскоязычных рекомендаций",
    changes: [
      "Добавлена проверка языка описаний и хештегов для повышения релевантности рекомендаций.",
      "Добавлены тесты языкового определения роликов.",
    ],
  },
  {
    version: "1.0.2",
    date: "06.11.2026",
    title: "Улучшение производительности и интерфейса",
    changes: [
      "Оставлен только один активный TikTok-плеер; соседние ролики используют лёгкие постеры.",
      "Обновлены цвета, кнопки и элементы управления ленты.",
      "Поиск новых роликов переключён на преимущественно русскоязычные темы.",
      "В рекомендациях появился дополнительный приоритет русскоязычных описаний и хештегов.",
      "Перед каждой production-сборкой автоматически запускаются тесты ленты и рекомендаций.",
    ],
  },
  {
    version: "1.0.1",
    date: "06.11.2026",
    title: "Добавлен журнал обновлений",
    changes: [
      "Добавлена отдельная страница с историей изменений TikTok Mod Web.",
      "На главной странице появилась кнопка «Обновления».",
      "Снижена нагрузка на браузер: лента держит текущий и один следующий видеоплеер вместо трёх.",
      "Новые функции, исправления и улучшения будут записываться сюда.",
    ],
  },
];

export default function UpdatesPage() {
  return (
    <main className="h-dvh overflow-y-auto overscroll-y-contain touch-pan-y bg-black px-4 py-8 text-white sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/"
          className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
        >
          ← Назад в ленту
        </Link>

        <header className="mb-8 mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
            TikTok Mod Web
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Журнал обновлений
          </h1>
          <p className="mt-3 text-sm text-white/60">
            Здесь публикуется история новых функций, исправлений и улучшений сайта.
          </p>
        </header>

        <div className="space-y-4">
          {updates.map((update) => (
            <article
              key={update.version}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-xl shadow-black/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-bold text-cyan-200">
                  Версия {update.version}
                </span>
                <time className="text-xs text-white/45">{update.date}</time>
              </div>
              <h2 className="mt-4 text-lg font-bold">{update.title}</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-white/75">
                {update.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-white/35">
          История обновлений TikTok Mod Web
        </p>
      </div>
    </main>
  );
}
