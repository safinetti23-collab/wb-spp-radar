import { db } from "@/db";
import { priceSnapshots, products } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { fetchVendorCode } from "@/lib/wb";
import type { HistoryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/[nmId]/history
 * История цен + ленивый фетч вендор-кода (артикула продавца) с сайта.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ nmId: string }> }
) {
  const { nmId: raw } = await ctx.params;
  const nmId = Number(raw);
  if (!Number.isFinite(nmId) || nmId <= 0) {
    return Response.json({ ok: false, history: [], vendorCode: null, walletNote: null } satisfies HistoryResponse, { status: 400 });
  }

  const prod = await db
    .select()
    .from(products)
    .where(eq(products.nmId, nmId))
    .limit(1);

  if (!prod.length) {
    return Response.json(
      { ok: false, history: [], vendorCode: null, walletNote: null } satisfies HistoryResponse,
      { status: 404 }
    );
  }

  const p = prod[0];
  let vendorCode = p.vendorCode;
  if (!vendorCode) {
    const fetched = await fetchVendorCode(nmId);
    if (fetched) {
      vendorCode = fetched;
      await db
        .update(products)
        .set({ vendorCode: fetched })
        .where(eq(products.id, p.id));
    }
  }

  const hist = await db
    .select()
    .from(priceSnapshots)
    .where(eq(priceSnapshots.productId, p.id))
    .orderBy(asc(priceSnapshots.fetchedAt))
    .limit(500);

  return Response.json({
    ok: true,
    vendorCode,
    walletNote:
      "Скидка «WB Кошелёк» применяется при оплате кошельком поверх цены с СПП и зависит от суммы покупки — в открытом API маркетплейс её не отдаёт.",
    history: hist.map((s) => ({
      fetchedAt: s.fetchedAt.toISOString(),
      priceProduct: s.priceProduct,
      priceTotal: s.priceTotal,
      priceBasic: s.priceBasic,
      sppPercent: s.sppPercent,
      totalQty: s.totalQty ?? 0,
    })),
  } satisfies HistoryResponse);
}
