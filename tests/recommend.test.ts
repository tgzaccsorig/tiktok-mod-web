import test from "node:test";
import assert from "node:assert/strict";
import { buildPass } from "../src/lib/recommend";
import type { VideoItem } from "../src/lib/types";

const video = (id: string): VideoItem => ({
  id,
  url: `https://www.tiktok.com/@creator/video/${id}`,
  author: "creator",
  authorUrl: "https://www.tiktok.com/@creator",
  title: id,
  hashtags: [],
  music: null,
  thumbnail: null,
  categories: ["memes"],
});

const pool = [video("one"), video("two"), video("three")];
const emptyContext = { likes: [], favs: [], history: [] };

test("recommendations exclude videos from recent watch history when unseen videos remain", () => {
  const result = buildPass(
    "foryou",
    pool,
    { ...emptyContext, history: [{ id: "one", ts: 1 }] },
    () => 0.5,
  );

  assert.deepEqual(result.map((item) => item.id).sort(), ["three", "two"]);
});

test("recommendations start a new cycle only after every available video was watched", () => {
  const result = buildPass(
    "foryou",
    pool,
    {
      ...emptyContext,
      history: pool.map((item, index) => ({ id: item.id, ts: index + 1 })),
    },
    () => 0.5,
  );

  assert.equal(result.length, pool.length);
});

test("favorites and history tabs keep their explicit library behavior", () => {
  const ctx = {
    likes: [],
    favs: ["one"],
    history: [{ id: "two", ts: 2 }],
  };

  assert.deepEqual(buildPass("favorites", pool, ctx).map((item) => item.id), ["one"]);
  assert.deepEqual(buildPass("history", pool, ctx).map((item) => item.id), ["two"]);
});
