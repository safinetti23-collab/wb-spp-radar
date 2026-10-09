import { db } from "@/db";
import {
  cabinetImports,
  cabinetRows,
  priceSnapshots,
  products,
} from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { coverUrl } from "@/lib/wb";
import type { ProductsResponse, ReportFlag, ReportRow } from "@/lib/types";

/**
 * Единый источник отчёта «SKU × цены сайта × цены ЛК»: используется и
 * HTTP-роутом, и экспортом в Google Sheets.
 */
export async function buildReport(supplierId = 0): Promise<ProductsResponse> {
  const prods = supplierId
    ? await db.select().from(products).where(eq(products.supplierId, supplierId))
    : await db.select().from(products);

  const suppliersRaw = await db
    .select({
      supplierId: products.supplierId,
      supplierName: products.supplierName,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .groupBy(products.supplierId, products.supplierName)
    .orderBy(products.supplierId);

  const lastImport = await db
    .select()
    .from(cabinetImports)
    .orderBy(desc(cabinetImports.id))
    .limit(1);

  if (prods.length === 0) {
    return {
      ok: true,
      rows: [],
      stats: {
        total: 0,
        withSnapshot: 0,
        withSpp: 0,
        avgSppPct: null,
        sumSppAmount: 0,
        belowCab: 0,
        outOfStock: 0,
        priceUp: 0,
        priceDown: 0,
        lastFetchedAt: null,
      },
      suppliers: suppliersRaw,
      hasImport: lastImport.length > 0,
      lastImportAt: lastImport[0]?.uploadedAt?.toISOString() ?? null,
    };
  }

  const ids = prods.map((p) => p.id);

  const snaps = await db
    .select()
    .from(priceSnapshots)
    .where(inArray(priceSnapshots.productId, ids))
    .orderBy(asc(priceSnapshots.productId), desc(priceSnapshots.fetchedAt));

  const snapsByProduct = new Map<
    number,
    Array<(typeof priceSnapshots)["$inferSelect"]>
  >();
  for (const s of snaps) {
    const arr = snapsByProduct.get(s.productId) ?? [];
    if (arr.length < 2) {
      arr.push(s);
      snapsByProduct.set(s.productId, arr);
    }
  }

  const cabByNm = new Map<number, (typeof cabinetRows)["$inferSelect"]>();
  if (lastImport.length) {
    const rows = await db
      .select()
      .from(cabinetRows)
      .where(eq(cabinetRows.importId, lastImport[0].id));
    for (const r of rows) {
      if (r.nmId != null && !cabByNm.has(r.nmId)) cabByNm.set(r.nmId, r);
    }
  }

  const reportRows: ReportRow[] = [];
  for (const p of prods) {
    const [latest, prev] = snapsByProduct.get(p.id) ?? [];
    const cab = cabByNm.get(p.nmId);

    const deltaProduct =
      latest?.priceProduct != null && prev?.priceProduct != null
        ? latest.priceProduct - prev.priceProduct
        : null;
    const deltaTotal =
      latest?.priceTotal != null && prev?.priceTotal != null
        ? latest.priceTotal - prev.priceTotal
        : null;
    const siteVsCab =
      latest?.priceProduct != null && cab?.sellerPrice != null
        ? latest.priceProduct - cab.sellerPrice
        : null;

    const flags: ReportFlag[] = [];
    if (!latest) flags.push("no_snapshot");
    if (latest && (latest.totalQty ?? 0) <= 0) flags.push("out_of_stock");
    if ((latest?.sppPercent ?? 0) >= 10) flags.push("spp_high");
    if (siteVsCab != null && siteVsCab <= -2) flags.push("below_cab");
    if (siteVsCab != null && siteVsCab >= 2) flags.push("above_cab");
    if (deltaTotal != null && deltaTotal <= -2) flags.push("price_down");
    if (deltaTotal != null && deltaTotal >= 2) flags.push("price_up");
    if (!cab) flags.push("no_cabinet");

    reportRows.push({
      id: p.id,
      nmId: p.nmId,
      vendorCode: p.vendorCode ?? cab?.vendorCode ?? null,
      name: p.name,
      brand: p.brand,
      subject: p.subject,
      supplierName: p.supplierName,
      pics: p.pics ?? 0,
      rating: p.rating,
      feedbacks: p.feedbacks,
      coverUrl: coverUrl(p.nmId),

      fetchedAt: latest?.fetchedAt?.toISOString() ?? null,
      priceBasic: latest?.priceBasic ?? null,
      priceProduct: latest?.priceProduct ?? null,
      priceTotal: latest?.priceTotal ?? null,
      sppPercent: latest?.sppPercent ?? null,
      sppAmount: latest?.sppAmount ?? null,
      priceSppMax: latest?.priceSppMax ?? null,
      priceWallet: latest?.priceWallet ?? null,
      totalQty: latest?.totalQty ?? 0,
      sizes: (latest?.sizes as ReportRow["sizes"]) ?? [],
      source: latest?.source ?? null,

      prevProduct: prev?.priceProduct ?? null,
      prevTotal: prev?.priceTotal ?? null,
      deltaProduct,
      deltaTotal,

      cabBasePrice: cab?.basePrice ?? null,
      cabDiscountPct: cab?.discountPct ?? null,
      cabSellerPrice: cab?.sellerPrice ?? null,
      cabImportedAt: lastImport[0]?.uploadedAt?.toISOString() ?? null,

      siteVsCab,
      flags,
    });
  }

  reportRows.sort((a, b) => (b.sppAmount ?? 0) - (a.sppAmount ?? 0));

  const withSnapshot = reportRows.filter((r) => r.fetchedAt);
  const sppRows = withSnapshot.filter((r) => (r.sppPercent ?? 0) > 0.01);

  return {
    ok: true,
    rows: reportRows,
    stats: {
      total: prods.length,
      withSnapshot: withSnapshot.length,
      withSpp: sppRows.length,
      avgSppPct:
        sppRows.length > 0
          ? Math.round(
              (sppRows.reduce((a, r) => a + (r.sppPercent ?? 0), 0) /
                sppRows.length) *
                100
            ) / 100
          : null,
      sumSppAmount: reportRows.reduce((a, r) => a + (r.sppAmount ?? 0), 0),
      belowCab: reportRows.filter((r) => r.flags.includes("below_cab")).length,
      outOfStock: reportRows.filter((r) => r.flags.includes("out_of_stock")).length,
      priceUp: reportRows.filter((r) => r.flags.includes("price_up")).length,
      priceDown: reportRows.filter((r) => r.flags.includes("price_down")).length,
      lastFetchedAt:
        withSnapshot
          .map((r) => r.fetchedAt!)
          .sort()
          .at(-1) ?? null,
    },
    suppliers: suppliersRaw,
    hasImport: lastImport.length > 0,
    lastImportAt: lastImport[0]?.uploadedAt?.toISOString() ?? null,
  };
}
