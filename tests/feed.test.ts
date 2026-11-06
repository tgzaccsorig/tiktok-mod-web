import test from "node:test";
import assert from "node:assert/strict";
import { clampIndex, decideSwipe, needsMore, nextPass, playerIndexes, toSlides, visibleIndexes } from "../src/lib/feedEngine";
import { buildPass, rank } from "../src/lib/recommend";
import { categorize, extractHashtags, isAllowedTikTokUrl, normalizeUrl, parseOembed } from "../src/lib/tiktok";
import type { VideoItem } from "../src/lib/types";

const mk = (id: string, categories: VideoItem["categories"] = [], author = "@a"): VideoItem => ({
  id,
  url: `https://www.tiktok.com/${author}/video/${id}`,
  author,
  authorUrl: "",
  title: "",
  hashtags: [],
  music: null,
  thumbnail: null,
  categories,
});

/* ---------- жесты ---------- */
test("свайп вверх (dy<0) → следующий ролик, вниз (dy>0) → предыдущий", () => {
  assert.equal(decideSwipe({ dy: -200, dt: 300, height: 800 }), "next");
  assert.equal(decideSwipe({ dy: 200, dt: 300, height: 800 }), "prev");
});

test("быстрый короткий флик тоже переключает", () => {
  assert.equal(decideSwipe({ dy: -40, dt: 60, height: 800 }), "next");
  assert.equal(decideSwipe({ dy: 40, dt: 60, height: 800 }), "prev");
});

test("медленный короткий жест не переключает, лёгкое касание — это тап", () => {
  assert.equal(decideSwipe({ dy: -30, dt: 900, height: 800 }), "stay");
  assert.equal(decideSwipe({ dy: 2, dt: 100, height: 800 }), "tap");
});

/* ---------- навигация по ленте ---------- */
test("индекс не выходит за границы ленты", () => {
  assert.equal(clampIndex(-1, 5), 0);
  assert.equal(clampIndex(9, 5), 4);
  assert.equal(clampIndex(3, 0), 0);
});

test("тяжёлый iframe монтируется только у текущего ролика, соседи — постеры", () => {
  assert.deepEqual(playerIndexes(0, 10), [0]);
  assert.deepEqual(playerIndexes(8, 10), [8]);
  assert.deepEqual(playerIndexes(9, 10), [9]);
  assert.deepEqual(playerIndexes(10, 10), []);
  assert.deepEqual(visibleIndexes(5, 10), [4, 5, 6]);
  assert.deepEqual(visibleIndexes(0, 10), [0, 1]);
});

test("лента бесконечна: когда видео заканчиваются, добавляется новый проход без повтора подряд", () => {
  const pool = [mk("1"), mk("2"), mk("3")];
  let queue = toSlides(pool, 0);
  let index = 0;
  const seen: string[] = [];
  for (let step = 0; step < 40; step++) {
    seen.push(queue[index].item.id);
    if (needsMore(index, queue.length)) {
      const last = queue[queue.length - 1];
      queue = [...queue, ...nextPass(rank(pool, { likes: [], favs: [], history: [] }), last.item.id, last.cycle + 1)];
    }
    index++;
    assert.ok(index < queue.length, "после подгрузки всегда есть следующий ролик");
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], "один и тот же ролик подряд");
  assert.equal(new Set(queue.map((s) => s.key)).size, queue.length, "ключи слайдов уникальны");
});

test("одно видео в каталоге: лента не обрывается", () => {
  const pool = [mk("1")];
  let queue = toSlides(pool, 0);
  for (let i = 0; i < 5; i++) {
    if (needsMore(i, queue.length)) {
      const last = queue[queue.length - 1];
      queue = [...queue, ...nextPass(pool, last.item.id, last.cycle + 1)];
    }
    assert.ok(queue[i + 1], "есть следующий слайд");
  }
});

/* ---------- рекомендации ---------- */
test("лайки по категории поднимают похожие ролики выше", () => {
  const pool = [mk("m1", ["memes"]), mk("g1", ["games"]), mk("g2", ["games"]), mk("a1", ["animals"])];
  const ctx = { likes: ["g1"], favs: ["g1"], history: [] };
  const out = rank(pool, ctx, () => 0.5).map((v) => v.id);
  assert.equal(out[0], "g1");
  assert.ok(out.indexOf("g2") < out.indexOf("m1"));
});

test("русскоязычные ролики получают приоритет в рекомендациях", () => {
  const ru = { ...mk("ru"), title: "Русский мем", hashtags: ["мемы"] };
  const en = { ...mk("en"), title: "Funny meme", hashtags: ["funny"] };
  assert.equal(rank([en, ru], { likes: [], favs: [], history: [] }, () => 0.5)[0].id, "ru");
});

test("режимы: категория, избранное, история, приоритет", () => {
  const pool = [mk("m1", ["memes"]), mk("g1", ["games"]), mk("a1", ["animals"])];
  const ctx = { likes: [], favs: ["a1", "g1"], history: [{ id: "m1", ts: 1 }, { id: "g1", ts: 5 }, { id: "m1", ts: 9 }] };
  assert.deepEqual(buildPass("games", pool, ctx).map((v) => v.id), ["g1"]);
  assert.deepEqual(buildPass("favorites", pool, ctx).map((v) => v.id), ["g1", "a1"]);
  assert.deepEqual(buildPass("history", pool, ctx).map((v) => v.id), ["m1", "g1"]);
  assert.equal(buildPass("random", pool, ctx).length, 3);
  assert.equal(buildPass("foryou", pool, ctx, Math.random, ["a1"])[0].id, "a1");
});

/* ---------- разбор oEmbed ---------- */
const OEMBED = {
  version: "1.0",
  type: "video",
  title: "Funny cat #cats #funny #fyp",
  author_name: "Scout",
  author_url: "https://www.tiktok.com/@scout2015",
  thumbnail_url: "https://example.invalid/t.jpg",
  html: '<blockquote class="tiktok-embed" data-video-id="6718335390845095173"><section><a title="♬ original sound - Scout &amp; Co" href="x">♬ original sound</a></section></blockquote>',
};

test("parseOembed достаёт id, автора, хештеги, музыку и категории", () => {
  const v = parseOembed("https://www.tiktok.com/@scout2015/video/6718335390845095173", OEMBED)!;
  assert.equal(v.id, "6718335390845095173");
  assert.equal(v.author, "@scout2015");
  assert.deepEqual(v.hashtags, ["cats", "funny", "fyp"]);
  assert.equal(v.music, "original sound - Scout & Co");
  assert.deepEqual(v.categories.sort(), ["animals", "humor"]);
});

test("parseOembed отбрасывает не-видео и ответы без id", () => {
  assert.equal(parseOembed("https://www.tiktok.com/@x", { type: "rich", html: "<blockquote></blockquote>" }), null);
});

test("проверка ссылок: только https и tiktok.com", () => {
  assert.ok(isAllowedTikTokUrl("https://www.tiktok.com/@a/video/1"));
  assert.ok(isAllowedTikTokUrl("https://vm.tiktok.com/abc"));
  assert.ok(!isAllowedTikTokUrl("http://www.tiktok.com/@a/video/1"));
  assert.ok(!isAllowedTikTokUrl("https://tiktok.com.evil.example/@a/video/1"));
  assert.ok(!isAllowedTikTokUrl("not a url"));
  assert.equal(normalizeUrl("www.tiktok.com/@a/video/1"), "https://www.tiktok.com/@a/video/1");
  assert.deepEqual(extractHashtags("a #b #b #мем"), ["b", "мем"]);
  assert.deepEqual(categorize("Minecraft funny"), ["minecraft", "humor"]);
});
