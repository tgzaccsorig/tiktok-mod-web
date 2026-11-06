import test from "node:test";
import assert from "node:assert/strict";
import { PAGES, TOPICS, extractVideoUrls, intervalMinutes, queryForSlot, slotOf } from "../src/lib/discoverCore";

test("из выдачи поиска остаются только ссылки на ролики, без дублей и мусора", () => {
  const links = [
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    "https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=en",
    "https://tiktok.com/@a.b_c/video/7503588440160701742/",
    "https://www.tiktok.com/discover/minecraft-memes",
    "https://www.tiktok.com/tag/funny",
    "https://www.tiktok.com/@scout2015",
    "https://www.tiktok.com/@scout2015/photo/7503588440160701742",
    "https://example.com/@x/video/7503588440160701799",
    "https://www.tiktok.com.evil.example/@x/video/7503588440160701799",
    "https://www.tiktok.com/@x/video/123",
  ];
  assert.deepEqual(extractVideoUrls(links), [
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    "https://www.tiktok.com/@a.b_c/video/7503588440160701742",
  ]);
});

test("слот времени: внутри интервала запрос тот же, в следующем интервале — другой", () => {
  const t0 = Date.UTC(2026, 10, 3, 10, 0, 0);
  const s0 = slotOf(t0, 5);
  assert.equal(slotOf(t0 + 4 * 60_000, 5), s0);
  assert.equal(slotOf(t0 + 5 * 60_000, 5), s0 + 1);
  assert.deepEqual(queryForSlot(s0), queryForSlot(s0));
  assert.notEqual(queryForSlot(s0).topic, queryForSlot(s0 + 1).topic);
});

test("перебор тем и страниц: каждая пара тема+страница встречается, цикл конечен", () => {
  const pairs = new Set<string>();
  for (let s = 0; s < TOPICS.length * PAGES; s++) {
    const { topic, page } = queryForSlot(s);
    assert.ok(page >= 0 && page < PAGES);
    pairs.add(`${topic}|${page}`);
  }
  assert.equal(pairs.size, TOPICS.length * PAGES);
  assert.equal(queryForSlot(TOPICS.length * PAGES).page, 0);
  assert.ok(queryForSlot(-3).q.startsWith("site:tiktok.com "));
  const russianTopics = TOPICS.filter((topic) => /[а-яё]/i.test(topic));
  assert.ok(russianTopics.length >= Math.ceil(TOPICS.length * 0.7), "большинство тем поиска должны быть русскоязычными");
});

test("интервал из переменной окружения", () => {
  assert.equal(intervalMinutes(undefined), 5);
  assert.equal(intervalMinutes("abc"), 5);
  assert.equal(intervalMinutes("0"), 5);
  assert.equal(intervalMinutes("30"), 30);
  assert.equal(intervalMinutes("99999"), 1440);
});
