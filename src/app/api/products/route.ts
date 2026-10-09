import { buildReport } from "@/lib/report";

export const dynamic = "force-dynamic";

/**
 * GET /api/products?supplier=
 * Отчёт: SKU × цены сайта (последний снапшот) × цены из ЛК WB × соинвест.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const supplier = Math.trunc(Number(searchParams.get("supplier") ?? 0)) || 0;
  const report = await buildReport(supplier);
  return Response.json(report);
}
