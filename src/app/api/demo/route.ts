import { db } from "@/db";
import {
  cabinetImports,
  cabinetRows,
  priceSnapshots,
  products,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { DEFAULT_DEST, DEFAULT_SPP_MAX } from "@/lib/wb";

export const dynamic = "force-dynamic";

/** Детерминированный ГПСЧ, чтобы демо выглядело стабильно между сидированиями */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_SUPPLIER = 12520;

const ASSORTMENT: Array<[string, string, string, string, number]> = [
  // [название, бренд, категория, артикул продавца, базовая закупочная цена]
  ["Футболка оверсайз плотный хлопок", "NORDVEIN", "Футболки", "NV-TSH-01", 3990],
  ["Худи унисекс футер с начёсом", "NORDVEIN", "Худи", "NV-HDD-02", 7490],
  ["Свитшот оверсайз лапша", "NORDVEIN", "Свитшоты", "NV-SWT-03", 5990],
  ["Джоггеры спортивные на флисе", "NORDVEIN", "Брюки", "NV-JGG-04", 5490],
  ["Лонгслив базовый рибана", "NORDVEIN", "Лонгсливы", "NV-LNG-05", 2790],
  ["Куртка-бомбер на молнии", "AIST & SO", "Куртки", "AS-BMB-11", 12990],
  ["Плащ прямого кроя с поясом", "AIST & SO", "Плащи", "AS-PLS-12", 14990],
  ["Рубашка оверсайз оксфорд", "AIST & SO", "Рубашки", "AS-SRT-13", 6490],
  ["Джинсы прямые с высокой посадкой", "AIST & SO", "Джинсы", "AS-JNS-14", 7990],
  ["Юбка миди плиссированная", "AIST & SO", "Юбки", "AS-SKT-15", 5290],
  ["Платье трикотажное облегающее", "MILAVIA", "Платья", "MV-DRS-21", 6990],
  ["Топ базовый на бретелях", "MILAVIA", "Топы", "MV-TOP-22", 1590],
  ["Брюки палаццо высокая талия", "MILAVIA", "Брюки", "MV-BRK-23", 8990],
  ["Жакет приталенный однобортный", "MILAVIA", "Жакеты", "MV-JKT-24", 10990],
  ["Кардиган длинный шерстяной", "MILAVIA", "Кардиганы", "MV-CRD-25", 9490],
  ["Шорты бермуды с карманами", "KARTINA", "Шорты", "KT-SHR-31", 3990],
  ["Поло трикотажное с воротником", "KARTINA", "Поло", "KT-PLO-32", 4490],
  ["Ветровка с капюшоном", "KARTINA", "Ветровки", "KT-VTR-33", 9990],
  ["Костюм спортивный двойка", "KARTINA", "Костюмы", "KT-KST-34", 11490],
  ["Легинсы с высокой посадкой", "KARTINA", "Легинсы", "KT-LGN-35", 2990],
  ["Пижама сатиновая с рубашкой", "SOFI LINE", "Пижамы", "SL-PJM-41", 6490],
  ["Халат вафельный домашний", "SOFI LINE", "Халаты", "SL-HLT-42", 4990],
  ["Ночная рубашка комбинация", "SOFI LINE", "Сорочки", "SL-SRC-43", 3790],
  ["Комплект белья бесшовный", "SOFI LINE", "Бельё", "SL-KMP-44", 2490],
];

const SIZES_POOL = ["XS", "S", "M", "L", "XL"];

/**
 * POST /api/demo — сидирует правдоподобный отчёт:
 * 24 SKU, история цен за ~3 недели, выгрузка ЛК с ценами продавца.
 * DELETE /api/demo — полностью очищает базу.
 */
export async function POST() {
  const rnd = mulberry32(12520245);
  const now = Date.now();
  const DAY = 86400_000;

  // аптсерт товаров
  const nmBase = 15400000;
  const prodIds: Array<{
    dbId: number;
    nmId: number;
    base: number;
    discount: number;
    vendorCode: string;
    name: string;
    brand: string;
  }> = [];

  for (let i = 0; i < ASSORTMENT.length; i++) {
    const [name, brand, subject, vendorCode, base] = ASSORTMENT[i];
    const nmId = nmBase + 87101 + i * 13_579 + Math.floor(rnd() * 5000);
    const [rec] = await db
      .insert(products)
      .values({
        nmId,
        supplierId: DEMO_SUPPLIER,
        supplierName: 'ИП «Пример» — демо',
        vendorCode,
        name,
        brand,
        subject,
        pics: 6 + Math.floor(rnd() * 8),
        rating: Math.round((4.3 + rnd() * 0.6) * 10) / 10,
        feedbacks: 40 + Math.floor(rnd() * 4600),
      })
      .onConflictDoUpdate({
        target: products.nmId,
        set: { name, brand, subject, updatedAt: new Date() },
      })
      .returning({ id: products.id });

    prodIds.push({
      dbId: rec.id,
      nmId,
      base,
      discount: 25 + Math.floor(rnd() * 38), // скидка продавца 25–63%
      vendorCode,
      name,
      brand,
    });
  }

  // история снапшотов: 7 точек за 3 недели
  for (const pr of prodIds) {
    const points = 7;
    for (let k = points - 1; k >= 0; k--) {
      const at = new Date(now - k * 3 * DAY - Math.floor(rnd() * 5) * 3600_000);
      const drift = 1 + (rnd() - 0.5) * 0.07;
      const discounted = Math.round(
        (pr.base * (1 - pr.discount / 100)) * drift
      );

      // Фактическая скидка WB (соинвест) на каждой точке
      const sppPct =
        k === points - 1
          ? [0, 5, 10, 12, 15, 18, 20, 25, 28][Math.floor(rnd() * 9)]
          : [0, 0, 5, 10, 15, 20, 28][Math.floor(rnd() * 7)];
      const total = Math.round(discounted * (1 - sppPct / 100));
      const sppAmount = Math.max(0, discounted - total);
      const qty = rnd() < 0.07 ? 0 : 120 + Math.floor(rnd() * 3900);

      const sizes = SIZES_POOL.slice(0, 3 + Math.floor(rnd() * 3)).map((s) => ({
        name: s,
        basic: Math.round(pr.base * (1 + (rnd() - 0.5) * 0.02)),
        product: discounted,
        total,
      }));

      await db.insert(priceSnapshots).values({
        productId: pr.dbId,
        fetchedAt: at,
        dest: DEFAULT_DEST,
        priceBasic: Math.round(pr.base),
        priceProduct: discounted,
        priceTotal: total,
        sppPercent: sppPct,
        sppAmount,
        priceSppMax: Math.round(discounted * (1 - DEFAULT_SPP_MAX / 100)),
        priceWallet: rnd() < 0.4 ? Math.round(total * 0.95) : null,
        totalQty: qty,
        sizes,
        source: "demo",
      });
    }
  }

  // выгрузка ЛК WB: цены продавца (без соинвеста площадки, как в реальности)
  const [imp] = await db
    .insert(cabinetImports)
    .values({
      fileName: "wb-cabinet-prices-demo.xlsx",
      rowCount: prodIds.length,
      matchedCount: prodIds.length,
    })
    .returning({ id: cabinetImports.id });

  await db.insert(cabinetRows).values(
    prodIds.map((pr, i) => {
      // у 3 товаров намеренно «расходимся» с сайтом, чтобы были флаги
      const skew = i % 9 === 0 ? 1.06 : i % 11 === 0 ? 0.93 : 1;
      const sellerPrice = Math.round(
        pr.base * (1 - pr.discount / 100) * skew
      );
      return {
        importId: imp.id,
        nmId: pr.nmId,
        vendorCode: pr.vendorCode,
        title: pr.name,
        category: ASSORTMENT[i][2],
        basePrice: Math.round(pr.base),
        discountPct: pr.discount,
        sellerPrice,
      };
    })
  );

  return Response.json({
    ok: true,
    products: prodIds.length,
    snapshots: prodIds.length * 7,
    importId: imp.id,
    message:
      "Демо-данные готовы: 24 SKU, 168 точек истории, выгрузка ЛК. Замените их живым парсингом, когда будет доступ к WB.",
  });
}

export async function DELETE() {
  await db.execute(sql`TRUNCATE TABLE price_snapshots, cabinet_rows, cabinet_imports, products RESTART IDENTITY CASCADE`);
  return Response.json({ ok: true, message: "База очищена" });
}
