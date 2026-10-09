import { runParse } from "@/lib/pipeline";
import { DEFAULT_DEST } from "@/lib/wb";
import type { ParseResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/parse
 * body: { supplier?, dest?, maxPages? }
 * Парсит цены продавца с сайта WB и пишет снапшоты в БД.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* пустое тело — ок */
  }
  const supplier = Math.max(1, Math.trunc(Number(body.supplier ?? 12520)) || 12520);
  const dest = Math.trunc(Number(body.dest ?? DEFAULT_DEST)) || DEFAULT_DEST;
  const maxPages = Math.min(Math.max(1, Number(body.maxPages ?? 20) || 20), 40);

  const result: ParseResponse = await runParse({ supplier, dest, maxPages });
  const status = result.ok ? 200 : /заблокировал/.test(result.message ?? "") ? 502 : 500;
  return Response.json(result, { status });
}
