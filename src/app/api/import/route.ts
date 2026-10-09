import { db } from "@/db";
import { cabinetImports, cabinetRows, products } from "@/db/schema";
import type { ImportResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/import — multipart/form-data, поле "file".
 * Принимает выгрузку цен из личного кабинета WB (.xlsx / .csv).
 * Колонки определяются эвристически по заголовкам:
 *   «Артикул WB», «Артикул продавца», «Наименование», «Категория»,
 *   «Цена», «Скидка, %», «Цена со скидкой».
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, message: "Файл не найден в запросе (поле file)" },
        { status: 400 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return Response.json({ ok: false, message: "Файл пустой" }, { status: 400 });
    }

    const XLSX = await import("xlsx");
    const isCsv = /\.csv$/i.test(file.name);

    const readBook = (codepage?: number) =>
      XLSX.read(buf, {
        type: "buffer",
        ...(codepage ? { codepage } : {}),
        raw: false,
      });

    let wb = readBook(isCsv ? undefined : undefined);
    let sheetName = wb.SheetNames[0];
    let grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    });

    // cp1251-фолбэк для CSV в старой кодировке
    let headerIdx = findHeaderRow(grid);
    if (isCsv && headerIdx < 0) {
      wb = readBook(1251);
      sheetName = wb.SheetNames[0];
      grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
        header: 1,
        defval: "",
        raw: false,
      });
      headerIdx = findHeaderRow(grid);
    }

    if (headerIdx < 0) {
      return Response.json(
        {
          ok: false,
          message:
            "Не удалось найти строку заголовков. Ожидаются колонки вида «Артикул WB», «Артикул продавца», «Цена»…",
        },
        { status: 422 }
      );
    }

    const header = grid[headerIdx].map((c) => normalizeCell(String(c ?? "")));
    const col = detectColumns(header);

    if (col.nmId < 0 && col.vendorCode < 0) {
      return Response.json(
        {
          ok: false,
          message:
            "В файле нет колонки «Артикул WB» или «Артикул продавца» — по ним идёт связка с каталогом.",
        },
        { status: 422 }
      );
    }

    interface ParsedRow {
      nmId: number | null;
      vendorCode: string | null;
      title: string | null;
      category: string | null;
      basePrice: number | null;
      discountPct: number | null;
      sellerPrice: number | null;
    }

    const parsed: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!Array.isArray(row) || row.length === 0) continue;
      const nmRaw = col.nmId >= 0 ? String(row[col.nmId] ?? "") : "";
      const vcRaw = col.vendorCode >= 0 ? String(row[col.vendorCode] ?? "") : "";
      const nmId = parseNm(nmRaw);
      const vendorCode = vcRaw.trim() || null;
      if (nmId == null && vendorCode == null) continue;

      const basePrice = col.basePrice >= 0 ? parseMoney(String(row[col.basePrice] ?? "")) : null;
      const discountPct = col.discount >= 0 ? parsePct(String(row[col.discount] ?? "")) : null;
      let sellerPrice = col.sellerPrice >= 0 ? parseMoney(String(row[col.sellerPrice] ?? "")) : null;
      if (sellerPrice == null && basePrice != null && discountPct != null) {
        sellerPrice = Math.round(basePrice * (1 - discountPct / 100));
      }

      parsed.push({
        nmId,
        vendorCode,
        title: col.title >= 0 ? String(row[col.title] ?? "").trim() || null : null,
        category: col.category >= 0 ? String(row[col.category] ?? "").trim() || null : null,
        basePrice,
        discountPct,
        sellerPrice,
      });
    }

    if (!parsed.length) {
      return Response.json(
        { ok: false, message: "В файле не нашлось ни одной строки с артикулами" },
        { status: 422 }
      );
    }

    // Связка с каталогом для подсчёта matched
    const all = await db.select({ nmId: products.nmId, vendorCode: products.vendorCode }).from(products);
    const knownNm = new Set(all.map((p) => p.nmId));
    const knownVc = new Set(all.map((p) => (p.vendorCode ?? "").toLowerCase()).filter(Boolean));
    const matched = parsed.filter(
      (r) =>
        (r.nmId != null && knownNm.has(r.nmId)) ||
        (r.vendorCode != null && knownVc.has(r.vendorCode.toLowerCase()))
    ).length;

    const [imp] = await db
      .insert(cabinetImports)
      .values({ fileName: file.name, rowCount: parsed.length, matchedCount: matched })
      .returning({ id: cabinetImports.id });

    await db.insert(cabinetRows).values(
      parsed.map((r) => ({
        importId: imp.id,
        nmId: r.nmId,
        vendorCode: r.vendorCode,
        title: r.title,
        category: r.category,
        basePrice: r.basePrice,
        discountPct: r.discountPct,
        sellerPrice: r.sellerPrice,
      }))
    );

    const headerRow = grid[headerIdx].map((c) => String(c ?? "").trim());
    return Response.json({
      ok: true,
      importId: imp.id,
      rowCount: parsed.length,
      matchedCount: matched,
      sheetName,
      columns: {
        nmId: col.nmId >= 0 ? headerRow[col.nmId] : undefined,
        vendorCode: col.vendorCode >= 0 ? headerRow[col.vendorCode] : undefined,
        basePrice: col.basePrice >= 0 ? headerRow[col.basePrice] : undefined,
        discount: col.discount >= 0 ? headerRow[col.discount] : undefined,
        sellerPrice: col.sellerPrice >= 0 ? headerRow[col.sellerPrice] : undefined,
      },
    } satisfies ImportResponse);
  } catch (e) {
    return Response.json(
      {
        ok: false,
        message: `Импорт не удался: ${e instanceof Error ? e.message : "неизвестная ошибка"}`,
      },
      { status: 500 }
    );
  }
}

function normalizeCell(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const row = grid[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => normalizeCell(String(c ?? "")));
    const hits = cells.filter(
      (c) =>
        c.includes("артикул") ||
        c.includes("цена") ||
        c.includes("скидк") ||
        c.includes("наимен")
    ).length;
    if (hits >= 2) return i;
  }
  return -1;
}

function detectColumns(header: string[]) {
  const col = { nmId: -1, vendorCode: -1, title: -1, category: -1, basePrice: -1, discount: -1, sellerPrice: -1 };
  header.forEach((h, i) => {
    if (!h) return;
    const isArticle = h.includes("артикул") || h === "nmid" || h === "nm id" || h === "nm";
    if (isArticle) {
      if (h.includes("продав") || h.includes("поставщ")) {
        if (col.vendorCode < 0) col.vendorCode = i;
      } else if (
        h.includes("wb") || h.includes("вб") || h.includes("wildberries") ||
        h === "nmid" || h === "nm id" || h === "nm"
      ) {
        if (col.nmId < 0) col.nmId = i;
      }
    }
    if (h.includes("наимен") || h.includes("назван")) if (col.title < 0) col.title = i;
    if (h.includes("категор")) if (col.category < 0) col.category = i;
    if (h.includes("скидк")) if (col.discount < 0) col.discount = i;
    if (h.includes("цена")) {
      if (h.includes("скид") || h.includes("спп") || h.includes("итог")) {
        if (col.sellerPrice < 0) col.sellerPrice = i;
      } else if (col.basePrice < 0) {
        col.basePrice = i;
      }
    }
  });
  return col;
}

function parseNm(s: string): number | null {
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 1000 ? n : null;
}

function parseMoney(s: string): number | null {
  const clean = s.replace(/[₽рР\s ]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parsePct(s: string): number | null {
  const clean = s.replace(/[%\s ]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
