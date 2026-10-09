import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { extractSheetId, getAutomation, patchAutomation } from "@/lib/settings";
import { googleCredsConfigured, serviceAccountEmail } from "@/lib/gsheets";
import type { AutomationResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMITS = { intervalHours: [1, 168] as const };

export async function GET() {
  const cfg = await getAutomation();
  const jobs = await db
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.id))
    .limit(12);

  return Response.json({
    ok: true,
    config: cfg,
    jobs: jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      trigger: j.trigger,
      status: j.status,
      supplier: j.supplier,
      rowsProcessed: j.rowsProcessed,
      snapshotsAdded: j.snapshotsAdded,
      sheetRows: j.sheetRows,
      startedAt: j.startedAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
      message: j.message,
      error: j.error,
    })),
    env: {
      googleCreds: googleCredsConfigured(),
      wbProxy: Boolean(process.env.WB_PROXY_URL),
      cronSecret: Boolean(process.env.CRON_SECRET),
      serviceEmail: serviceAccountEmail(),
    },
  } satisfies AutomationResponse);
}

/**
 * POST /api/automation — сохранение настроек.
 * body: { enabled?, exportEnabled?, intervalHours?, supplier?, sheetId?, tabReport?, tabHistory? }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ок */
  }
  const patch: Parameters<typeof patchAutomation>[0] = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.exportEnabled === "boolean") patch.exportEnabled = body.exportEnabled;
  if (body.intervalHours != null) {
    const h = Math.trunc(Number(body.intervalHours));
    if (Number.isFinite(h))
      patch.intervalHours = Math.max(LIMITS.intervalHours[0], Math.min(LIMITS.intervalHours[1], h));
  }
  if (body.supplier != null) {
    const s = Math.trunc(Number(body.supplier));
    if (Number.isFinite(s) && s > 0) patch.supplier = s;
  }
  if (typeof body.sheetId === "string") patch.sheetId = extractSheetId(body.sheetId);
  if (typeof body.tabReport === "string" && body.tabReport.trim())
    patch.tabReport = body.tabReport.trim().slice(0, 60);
  if (typeof body.tabHistory === "string" && body.tabHistory.trim())
    patch.tabHistory = body.tabHistory.trim().slice(0, 60);

  await patchAutomation(patch);
  const cfg = await getAutomation();
  return Response.json({ ok: true, config: cfg });
}
