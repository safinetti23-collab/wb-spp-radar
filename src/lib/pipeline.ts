import { db } from "@/db";
import { jobRuns, priceSnapshots, products } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_DEST,
  DEFAULT_SPP_MAX,
  WbApiError,
  chunk,
  enumerateSellerProducts,
  fetchCardsDetail,
  type WbProduct,
} from "@/lib/wb";
import { getAutomation, patchAutomation } from "@/lib/settings";
import { exportReportToSheets } from "@/lib/gsheets";
import { buildReport } from "@/lib/report";
import type { ParseResponse, PipelineRunResponse } from "@/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n);

export interface ParseOptions {
  supplier: number;
  dest?: number;
  maxPages?: number;
}

/**
 * Полный цикл парсинга продавца: каталог → три ценовых прохода (без СПП /
 * дефолт сервера / СПП 30%) → апсерт товаров → снапшоты.
 * Не бросает исключения наружу, кроме системных — ошибки WB приходят в полях.
 */
export async function runParse(opts: ParseOptions): Promise<ParseResponse> {
  const { supplier } = opts;
  const dest = opts.dest ?? DEFAULT_DEST;
  const maxPages = Math.min(Math.max(1, opts.maxPages ?? 20), 40);
  const started = Date.now();
  const errors: string[] = [];

  try {
    const { products: catalog, pages } = await enumerateSellerProducts(
      supplier,
      dest,
      maxPages
    );
    if (!catalog.length) {
      return {
        ok: false,
        supplier,
        pages: 0,
        found: 0,
        upserted: 0,
        snapshots: 0,
        durationMs: Date.now() - started,
        errors: ["Каталог продавца пуст или недоступен"],
        message: `Для продавца ${supplier} не найдено ни одного товара`,
      };
    }

    const catalogById = new Map(catalog.map((p) => [p.nmId, p]));
    const nmIds = catalog.map((p) => p.nmId);

    interface Merged {
      p: WbProduct;
      basic: number | null;
      productP: number | null;
      totalSite: number | null;
      totalMax: number | null;
      qty: number;
    }
    const merged = new Map<number, Merged>();
    const chunks = chunk(nmIds, 100);

    for (let ci = 0; ci < chunks.length; ci++) {
      const ids = chunks[ci];
      try {
        const [base, site, max] = await Promise.all([
          fetchCardsDetail(ids, dest, 0),
          fetchCardsDetail(ids, dest, null),
          fetchCardsDetail(ids, dest, DEFAULT_SPP_MAX),
        ]);
        const siteById = new Map(site.map((p) => [p.nmId, p]));
        const maxById = new Map(max.map((p) => [p.nmId, p]));
        const baseById = new Map(base.map((p) => [p.nmId, p]));

        for (const id of ids) {
          const b0 = baseById.get(id);
          const s0 = siteById.get(id);
          const m0 = maxById.get(id);
          const c0 = catalogById.get(id);
          const p = b0 ?? s0 ?? m0 ?? c0;
          if (!p) continue;
          if (p.sizes.length === 0 && c0?.sizes.length) p.sizes = c0.sizes;

          const productP = rnd(p.priceProduct ?? s0?.priceProduct ?? c0?.priceProduct);
          const basic = rnd(p.priceBasic ?? s0?.priceBasic ?? c0?.priceBasic);
          let totalSite = rnd(s0?.priceTotal ?? p.priceTotal ?? productP);
          if (totalSite != null && productP != null && totalSite > productP)
            totalSite = productP;
          let totalMax = rnd(m0?.priceTotal);
          if (totalMax != null && productP != null && totalMax > productP)
            totalMax = Math.round(productP * (1 - DEFAULT_SPP_MAX / 100));

          merged.set(id, { p, basic, productP, totalSite, totalMax, qty: p.totalQuantity });
        }
      } catch (e) {
        errors.push(`Батч ${ci + 1}: ${e instanceof Error ? e.message : "ошибка запроса"}`);
        for (const id of ids) {
          const c = catalogById.get(id);
          if (c) {
            merged.set(id, {
              p: c,
              basic: c.priceBasic,
              productP: c.priceProduct,
              totalSite: c.priceTotal,
              totalMax: null,
              qty: c.totalQuantity,
            });
          }
        }
      }
      if (ci < chunks.length - 1) await sleep(250);
    }

    const rows = [...merged.values()];
    const now = new Date();
    let upserted = 0;
    const idByNm = new Map<number, number>();

    for (const part of chunk(rows, 50)) {
      const inserted = await db
        .insert(products)
        .values(
          part.map(({ p }) => ({
            nmId: p.nmId,
            supplierId: p.supplierId || supplier,
            supplierName: p.supplierName,
            vendorCode: p.vendorCode,
            name: p.name || `Товар ${p.nmId}`,
            brand: p.brand,
            subject: p.subject,
            pics: p.pics ?? 0,
            rating: p.rating,
            feedbacks: p.feedbacks ?? 0,
            updatedAt: now,
          }))
        )
        .onConflictDoUpdate({
          target: products.nmId,
          set: {
            supplierId: products.supplierId,
            supplierName: products.supplierName,
            name: products.name,
            brand: products.brand,
            subject: products.subject,
            pics: products.pics,
            rating: products.rating,
            feedbacks: products.feedbacks,
            updatedAt: now,
          },
        })
        .returning({ id: products.id, nmId: products.nmId });
      for (const r of inserted) idByNm.set(r.nmId, r.id);
      upserted += inserted.length;
    }

    let snapshots = 0;
    const snapValues = rows
      .map((m) => {
        const productId = idByNm.get(m.p.nmId);
        if (!productId) return null;
        const sppAmount =
          m.productP != null && m.totalSite != null
            ? Math.max(0, m.productP - m.totalSite)
            : null;
        const sppPercent =
          m.productP && m.productP > 0 && sppAmount != null
            ? Math.round((sppAmount / m.productP) * 10000) / 100
            : null;
        return {
          productId,
          dest,
          priceBasic: m.basic,
          priceProduct: m.productP,
          priceTotal: m.totalSite,
          sppPercent,
          sppAmount,
          priceSppMax: m.totalMax,
          priceWallet: null,
          totalQty: m.qty,
          sizes: m.p.sizes,
          source: "live" as const,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v != null);

    for (const part of chunk(snapValues, 100)) {
      await db.insert(priceSnapshots).values(part);
      snapshots += part.length;
    }

    return {
      ok: true,
      supplier,
      pages,
      found: catalog.length,
      upserted,
      snapshots,
      durationMs: Date.now() - started,
      errors,
    };
  } catch (e) {
    return {
      ok: false,
      supplier,
      pages: 0,
      found: 0,
      upserted: 0,
      snapshots: 0,
      durationMs: Date.now() - started,
      errors: [e instanceof Error ? e.message : "неизвестная ошибка"],
      message:
        e instanceof WbApiError
          ? e.message
          : `Парсинг не удался: ${e instanceof Error ? e.message : "неизвестная ошибка"}`,
    };
  }
}

export type PipelineTrigger = "manual" | "schedule" | "cron";

/**
 * Пайплайн: парсинг (по расписанию или вручную) → выгрузка в Google Sheets.
 * Все запуски фиксируются в job_runs.
 */
export async function runPipeline(opts: {
  trigger: PipelineTrigger;
  supplier?: number;
  doParse?: boolean;
  doExport?: boolean;
}): Promise<PipelineRunResponse> {
  const cfg = await getAutomation();
  const supplier = opts.supplier ?? cfg.supplier;
  const doParse = opts.doParse ?? true;
  const doExport = opts.doExport ?? cfg.exportEnabled;

  const [job] = await db
    .insert(jobRuns)
    .values({ kind: "pipeline", trigger: opts.trigger, status: "running", supplier })
    .returning({ id: jobRuns.id });

  const result: PipelineRunResponse = { ok: true, jobId: job.id };
  let failed: string | null = null;

  try {
    if (doParse) {
      const parse = await runParse({ supplier });
      result.parse = {
        found: parse.found,
        snapshots: parse.snapshots,
        durationMs: parse.durationMs,
        errors: parse.errors,
      };
      if (!parse.ok) failed = parse.message ?? "Парсинг завершился с ошибкой";
    }

    if (doExport && !failed) {
      const sheetId = cfg.sheetId || (process.env.GOOGLE_SHEET_ID ?? "").trim();
      if (!sheetId) {
        result.message = "Парсинг выполнен, но выгрузка пропущена: не задан ID таблицы";
      } else {
        try {
          const report = await buildReport(supplier);
          const ex = await exportReportToSheets(report, {
            sheetId,
            tabReport: cfg.tabReport,
            tabHistory: cfg.tabHistory,
          });
          result.export = ex;
          await patchAutomation({ lastExportAt: new Date().toISOString() });
        } catch (e) {
          result.message = `Выгрузка в Sheets не удалась: ${e instanceof Error ? e.message : "ошибка"}`;
        }
      }
    }

    await patchAutomation({ lastRunAt: new Date().toISOString() });
    result.ok = !failed;

    await db
      .update(jobRuns)
      .set({
        status: failed ? "error" : "ok",
        finishedAt: new Date(),
        rowsProcessed: result.parse?.found ?? 0,
        snapshotsAdded: result.parse?.snapshots ?? 0,
        sheetRows: result.export?.reportRows ?? 0,
        message: result.message ?? null,
        error: failed,
      })
      .where(eq(jobRuns.id, job.id));

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "неизвестная ошибка";
    await db
      .update(jobRuns)
      .set({
        status: "error",
        finishedAt: new Date(),
        rowsProcessed: result.parse?.found ?? 0,
        snapshotsAdded: result.parse?.snapshots ?? 0,
        sheetRows: result.export?.reportRows ?? 0,
        error: msg,
      })
      .where(eq(jobRuns.id, job.id));
    result.ok = false;
    result.message = msg;
    return result;
  }
}
