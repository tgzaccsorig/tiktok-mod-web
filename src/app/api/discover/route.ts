import { NextResponse } from "next/server";
import { discover } from "@/lib/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/discover — новая порция роликов из поискового API.
 * Ответ кэшируется на CDN на время интервала (по умолчанию 5 минут): запрос к поиску
 * делается не чаще одного раза за интервал, сколько бы людей ни открыло сайт.
 */
export async function GET() {
  const result = await discover();
  const ttl = result.intervalMin * 60;
  let cache: string;
  if (!result.configured) cache = "public, s-maxage=3600";
  else if (result.error || result.items.length === 0) cache = "public, s-maxage=120"; // не долбим лимит при сбоях и пустых выдачах
  else cache = `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}`;
  return NextResponse.json(result, { headers: { "Cache-Control": cache } });
}
