import { runPipeline } from "@/lib/pipeline";
import type { PipelineRunResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/pipeline/run — кнопка «запустить сейчас»: парсинг + выгрузка.
 * body: { supplier?, doExport? }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ок */
  }
  const supplierRaw = Math.trunc(Number(body.supplier ?? 0)) || undefined;
  const result: PipelineRunResponse = await runPipeline({
    trigger: "manual",
    supplier: supplierRaw,
    doParse: true,
    doExport: typeof body.doExport === "boolean" ? body.doExport : undefined,
  });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
