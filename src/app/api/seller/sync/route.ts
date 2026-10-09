import { db } from "@/db";
import { cabinetImports, cabinetRows, products, settings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  listSellerCards,
  listSellerPrices,
  SellerApiError,
} from "@/lib/wb-seller";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOKEN_KEY = "wb.apiToken";

async function readToken(): Promise<string> {
  const fromEnv = (process.env.WB_API_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  const rows = await db.select().from(settings).where(eq(settings.key, TOKEN_KEY));
  return (rows[0]?.value ?? "").trim();
}

/**
 * POST /api/seller/sync
 * body: { token?: string, supplierId?: number }
 * Тянет карточки и цены из официального API кабинета и пишет их в базу.
 * Ключ можно передать один раз — он сохранится в настройках (не в браузере).
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* пустое тело */
  }

  const incoming = typeof body.token === "string" ? body.token.trim() : "";
  let token = incoming || (await readToken());
  if (!token) {
    return Response.json(
      {
        ok: false,
        needToken: true,
        message: "Нет API-ключа. Вставь токен из кабинета WB (Настройки → Доступ к API).",
      },
      { status: 400 }
    );
  }

  if (incoming) {
    const now = new Date();
    await db
      .insert(settings)
      .values({ key: TOKEN_KEY, value: incoming, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: incoming, updatedAt: now },
      });
    token = incoming;
  }

  const supplierId = Math.max(0, Math.trunc(Number(body.supplierId ?? 0)) || 0);

  try {
    const cards = await listSellerCards(token);
    let prices: Awaited<ReturnType<typeof listSellerPrices>> = [];
    let priceError: string | null = null;
    try {
      prices = await listSellerPrices(token);
    } catch (e) {
      priceError = e instanceof Error ? e.message : "цены не загрузились";
    }

    if (!cards.length && !prices.length) {
      return Response.json(
        {
          ok: false,
          message:
            "API ответил пустым списком. Проверь, что токен от этого магазина и в нём есть категория «Контент».",
        },
        { status: 422 }
      );
    }

    const byNm = new Map<
      number,
      {
        nmId: number;
        vendorCode: string | null;
        title: string;
        brand: string | null;
        subject: string | null;
      }
    >();
    for (const c of cards) byNm.set(c.nmId, c);
    for (const p of prices) {
      if (!byNm.has(p.nmId)) {
        byNm.set(p.nmId, {
          nmId: p.nmId,
          vendorCode: p.vendorCode,
          title: p.vendorCode ? `Артикул ${p.vendorCode}` : `Товар ${p.nmId}`,
          brand: null,
          subject: null,
        });
      }
    }

    const now = new Date();
    const list = [...byNm.values()];
    for (let i = 0; i < list.length; i += 50) {
      const part = list.slice(i, i + 50);
      await db
        .insert(products)
        .values(
          part.map((p) => ({
            nmId: p.nmId,
            supplierId,
            supplierName: "Мой магазин",
            vendorCode: p.vendorCode,
            name: p.title || `Товар ${p.nmId}`,
            brand: p.brand,
            subject: p.subject,
            updatedAt: now,
          }))
        )
        .onConflictDoUpdate({
          target: products.nmId,
          set: {
            supplierId,
            supplierName: "Мой магазин",
            vendorCode: sql`excluded.vendor_code`,
            name: sql`excluded.name`,
            brand: sql`excluded.brand`,
            subject: sql`excluded.subject`,
            updatedAt: now,
          },
        });
    }

    let importId: number | null = null;
    if (prices.length) {
      const [imp] = await db
        .insert(cabinetImports)
        .values({
          fileName: "API: цены и скидки",
          rowCount: prices.length,
          matchedCount: prices.length,
        })
        .returning({ id: cabinetImports.id });
      importId = imp.id;
      for (let i = 0; i < prices.length; i += 200) {
        const part = prices.slice(i, i + 200);
        await db.insert(cabinetRows).values(
          part.map((r) => ({
            importId: imp.id,
            nmId: r.nmId,
            vendorCode: r.vendorCode,
            title: byNm.get(r.nmId)?.title ?? null,
            category: byNm.get(r.nmId)?.subject ?? null,
            basePrice: r.basePrice,
            discountPct: r.discountPct,
            sellerPrice: r.sellerPrice,
          }))
        );
      }
    }

    return Response.json({
      ok: true,
      cards: cards.length,
      prices: prices.length,
      products: list.length,
      importId,
      priceError,
      message: priceError
        ? `Карточки загружены: ${list.length}. Цены не пришли: ${priceError}`
        : `Загружено товаров: ${list.length}, цен из кабинета: ${prices.length}. Цена покупателя (СПП) по-прежнему берётся с сайта.`,
    });
  } catch (e) {
    const status = e instanceof SellerApiError ? (e.status === 401 || e.status === 403 ? 401 : 502) : 500;
    return Response.json(
      { ok: false, message: e instanceof Error ? e.message : "ошибка API" },
      { status }
    );
  }
}
