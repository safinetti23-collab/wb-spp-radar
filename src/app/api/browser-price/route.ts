import { db } from "@/db";
import { priceSnapshots, products } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/browser-price
 * Цены, которые расширение сняло с уже открытой вкладки товара.
 * body: { nmId, priceBasic, priceProduct, priceTotal, totalQty? }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, message: "пустой запрос" }, { status: 400 });
  }

  const nmId = Math.trunc(Number(body.nmId));
  if (!Number.isFinite(nmId) || nmId <= 0) {
    return Response.json({ ok: false, message: "нет артикула" }, { status: 400 });
  }

  const num = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const priceBasic = num(body.priceBasic);
  const priceProduct = num(body.priceProduct);
  const priceTotal = num(body.priceTotal);
  const totalQty = Math.max(0, Math.trunc(Number(body.totalQty)) || 0);

  if (priceProduct == null && priceTotal == null) {
    return Response.json({ ok: false, message: "на странице не нашлись цены" }, { status: 422 });
  }

  const product = priceProduct ?? priceTotal;
  const total = priceTotal != null && product != null && priceTotal <= product ? priceTotal : product;
  const sppAmount = product != null && total != null ? Math.max(0, product - total) : null;
  const sppPercent =
    product && sppAmount != null ? Math.round((sppAmount / product) * 10000) / 100 : null;

  const found = await db.select({ id: products.id }).from(products).where(eq(products.nmId, nmId)).limit(1);
  if (!found.length) {
    return Response.json(
      { ok: false, message: `Артикул ${nmId} нет в базе. Сначала нажми «Мои товары».` },
      { status: 404 }
    );
  }

  await db.insert(priceSnapshots).values({
    productId: found[0].id,
    dest: -1257786,
    priceBasic,
    priceProduct: product,
    priceTotal: total,
    sppPercent,
    sppAmount,
    priceSppMax: product != null ? Math.round(product * 0.7) : null,
    totalQty,
    sizes: [],
    source: "browser",
  });

  return Response.json({
    ok: true,
    nmId,
    priceProduct: product,
    priceTotal: total,
    sppPercent,
    message: `Цена с вкладки сохранена: ${nmId}`,
  });
}
