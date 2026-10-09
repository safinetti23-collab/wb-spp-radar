import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildReport } from "@/lib/report";
import { exportReportToSheets } from "@/lib/gsheets";
import { extractSheetId, getAutomation, patchAutomation } from "@/lib/settings";
import type { SheetsExportResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/sheets/export — ручная выгрузка текущего отчёта в Google Sheets.
 * body: { sheetId?, saveSheetId?, supplier? }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ок */
  }

  const cfg = await getAutomation();
  const sheetId = extractSheetId(
    String(body.sheetId ?? cfg.sheetId ?? process.env.GOOGLE_SHEET_ID ?? "")
  );
  if (body.saveSheetId && sheetId) {
    await patchAutomation({ sheetId });
  }

  const [job] = await db
    .insert(jobRuns)
    .values({ kind: "sheets_export", trigger: "manual", status: "running" })
    .returning({ id: jobRuns.id });

  try {
    if (!sheetId) throw new Error("ID таблицы не задан — укажите его в настройках автоматизации");
    const supplier = Math.max(0, Math.trunc(Number(body.supplier ?? cfg.supplier)) || 0);
    const report = await buildReport(supplier);
    const result = await exportReportToSheets(report, {
      sheetId,
      tabReport: cfg.tabReport,
      tabHistory: cfg.tabHistory,
    });
    await patchAutomation({ lastExportAt: new Date().toISOString() });
    await db
      .update(jobRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        rowsProcessed: result.reportRows,
        sheetRows: result.reportRows,
        message: `Выгружено в «${cfg.tabReport}» + ${result.historyRows} строк истории`,
      })
      .where(eq(jobRuns.id, job.id));

    return Response.json({
      ok: true,
      reportRows: result.reportRows,
      historyRows: result.historyRows,
      url: result.url,
    } satisfies SheetsExportResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : "неизвестная ошибка";
    await db
      .update(jobRuns)
      .set({ status: "error", finishedAt: new Date(), error: message })
      .where(eq(jobRuns.id, job.id));
    return Response.json(
      { ok: false, message } satisfies SheetsExportResponse,
      { status: 500 }
    );
  }
}
