import test from "node:test";
import assert from "node:assert/strict";
import { clampContribution, worldGoalProgress, WINTER_WEATHER, WINTER_WORLD_EVENTS } from "../src/lib/winter-world";

test("world weather and event catalogues cover every server key", () => {
  assert.deepEqual(Object.keys(WINTER_WEATHER).sort(), ["aurora", "blizzard", "clear", "frost", "snowfall"].sort());
  assert.deepEqual(Object.keys(WINTER_WORLD_EVENTS).sort(), ["aurora_night", "frozen_gifts", "snowflake_rush", "snowman_parade"].sort());
});

test("contribution input is bounded to the supported integer range", () => {
  assert.equal(clampContribution(0), 1);
  assert.equal(clampContribution(15.8), 15);
  assert.equal(clampContribution(900), 500);
  assert.equal(clampContribution(Number.NaN), 10);
});

test("shared goal progress is clamped and safe for invalid targets", () => {
  assert.equal(worldGoalProgress(250, 1000), 25);
  assert.equal(worldGoalProgress(1200, 1000), 100);
  assert.equal(worldGoalProgress(-1, 1000), 0);
  assert.equal(worldGoalProgress(100, 0), 0);
});
