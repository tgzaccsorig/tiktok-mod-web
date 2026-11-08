import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("world migrations keep server writes protected and SQL quoting balanced", () => {
  const sql = readFileSync("supabase/migrations/20261108180525_winter_world_weather_events_goals.sql", "utf8");
  const permissions = readFileSync("supabase/migrations/20261108180536_winter_world_state_invoker_permissions.sql", "utf8");
  const quoteCount = sql.split("$").length - 1;
  assert.equal(quoteCount % 2, 0);
  assert.ok(sql.includes("alter table public.winter_world_goal_contributions enable row level security"));
  assert.ok(sql.includes("create or replace function public.winter_world_state()"));
  assert.ok(sql.includes("returns jsonb language sql security definer"));
  assert.ok(sql.includes("revoke all on function private.winter_world_state() from public, anon, authenticated"));
  assert.ok(sql.includes("grant execute on function public.winter_world_state() to anon, authenticated"));
  assert.ok(permissions.includes("alter function public.winter_world_state() security invoker"));
  assert.ok(permissions.includes("grant execute on function private.winter_world_state() to anon, authenticated"));
  assert.equal(sql.includes("stable"), false);
});
