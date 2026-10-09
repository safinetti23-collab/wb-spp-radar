import { runPipeline } from "@/lib/pipeline";
import type { PipelineRunResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // секрет не задан — эндпоинт открыт (dev-режим)
  const header = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const byQuery = url.searchParams.get("secret") ?? "";
  return header === `Bearer ${secret}` || byQuery === secret;
}

/**
 * Внешний планировщик (cron-job.org, crontab, Cloud Scheduler и т.п.):
 *   GET/POST /api/cron/run?export=1
 *   заголовок: Authorization: Bearer $CRON_SECRET
 *
 * Запускает пайплайн «парсинг → выгрузка в Sheets» независимо от того,
 * жив ли внутренний планировщик (полезно на serverless-хостингах).
 */
async function handler(req: Request) {
  if (!authorized(req)) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const doExport = url.searchParams.get("export") !== "0";
  const supplier = Math.trunc(Number(url.searchParams.get("supplier") ?? 0)) || undefined;

  const result: PipelineRunResponse = await runPipeline({
    trigger: "cron",
    supplier,
    doParse: true,
    doExport,
  });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
