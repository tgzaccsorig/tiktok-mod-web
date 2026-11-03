import { NextResponse } from "next/server";
import { fetchOembed } from "@/lib/tiktok";

export const runtime = "nodejs";

/** GET /api/oembed?url=<ссылка на видео TikTok> — проверка ссылки через официальный oEmbed TikTok. */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  const result = await fetchOembed(url);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reason === "not_allowed" ? 400 : 200 });
}
