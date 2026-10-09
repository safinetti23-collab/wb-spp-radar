/**
 * Официальный API кабинета продавца Wildberries.
 * Токен: заголовок Authorization (без слова Bearer).
 * Документация: https://dev.wildberries.ru/swagger/products
 *
 * Карточки: POST https://content-api.wildberries.ru/content/v2/get/cards/list
 * Цены:     GET  https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter
 */

const CONTENT = "https://content-api.wildberries.ru";
const PRICES = "https://discounts-prices-api.wildberries.ru";

export interface SellerCard {
  nmId: number;
  vendorCode: string | null;
  title: string;
  brand: string | null;
  subject: string | null;
}

export interface SellerPrice {
  nmId: number;
  vendorCode: string | null;
  basePrice: number | null;
  discountPct: number | null;
  sellerPrice: number | null;
}

export class SellerApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function wbPost(token: string, url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SellerApiError(
      res.status,
      res.status === 401 || res.status === 403
        ? `Ключ WB не принят (HTTP ${res.status}). Нужен токен с доступом «Контент» и «Цены и скидки».`
        : `WB API ${res.status}: ${text.slice(0, 180)}`
    );
  }
  return res.json();
}

async function wbGet(token: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SellerApiError(
      res.status,
      res.status === 401 || res.status === 403
        ? `Ключ WB не принят для цен (HTTP ${res.status}). В токене включи категорию «Цены и скидки».`
        : `WB API ${res.status}: ${text.slice(0, 180)}`
    );
  }
  return res.json();
}

/** Все карточки продавца, включая товары с фото (withPhoto = -1). */
export async function listSellerCards(token: string): Promise<SellerCard[]> {
  const out: SellerCard[] = [];
  let updatedAt: string | undefined;
  let nmID: number | undefined;

  for (let page = 0; page < 300; page++) {
    const cursor: Record<string, unknown> = { limit: 100 };
    if (updatedAt && nmID) {
      cursor.updatedAt = updatedAt;
      cursor.nmID = nmID;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await wbPost(token, `${CONTENT}/content/v2/get/cards/list`, {
      settings: {
        cursor,
        filter: { withPhoto: -1 },
      },
    })) as any;

    const cards: any[] = json?.cards ?? [];
    for (const c of cards) {
      const nmId = Number(c?.nmID ?? c?.nmId);
      if (!Number.isFinite(nmId) || nmId <= 0) continue;
      out.push({
        nmId,
        vendorCode: c?.vendorCode ? String(c.vendorCode) : null,
        title: String(c?.title ?? c?.name ?? `Товар ${nmId}`),
        brand: c?.brand ? String(c.brand) : null,
        subject: c?.subjectName ? String(c.subjectName) : null,
      });
    }

    const total = Number(json?.cursor?.total ?? cards.length);
    updatedAt = json?.cursor?.updatedAt;
    nmID = Number(json?.cursor?.nmID) || undefined;
    if (!cards.length || total < 100 || !updatedAt || !nmID) break;
    await sleep(400);
  }

  return out;
}

/** Цены и скидки продавца из «Цены и скидки» (не цена покупателя и не СПП). */
export async function listSellerPrices(token: string): Promise<SellerPrice[]> {
  const out: SellerPrice[] = [];
  const limit = 1000;

  for (let offset = 0; offset < 200_000; offset += limit) {
    const url = `${PRICES}/api/v2/list/goods/filter?limit=${limit}&offset=${offset}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await wbGet(token, url)) as any;
    const list: any[] = json?.data?.listGoods ?? [];
    for (const g of list) {
      const nmId = Number(g?.nmID ?? g?.nmId);
      if (!Number.isFinite(nmId) || nmId <= 0) continue;
      const sizes: any[] = Array.isArray(g?.sizes) ? g.sizes : [];
      const prices = sizes
        .map((s) => Number(s?.price))
        .filter((n) => Number.isFinite(n) && n > 0);
      const discounted = sizes
        .map((s) => Number(s?.discountedPrice))
        .filter((n) => Number.isFinite(n) && n > 0);
      const basePrice = prices.length ? Math.min(...prices) : null;
      const sellerPrice = discounted.length
        ? Math.min(...discounted)
        : basePrice;
      const discountPct =
        typeof g?.discount === "number" ? g.discount : null;
      out.push({
        nmId,
        vendorCode: g?.vendorCode ? String(g.vendorCode) : null,
        basePrice: basePrice != null ? Math.round(basePrice) : null,
        discountPct,
        sellerPrice: sellerPrice != null ? Math.round(sellerPrice) : null,
      });
    }
    if (list.length < limit) break;
    await sleep(400);
  }

  return out;
}
