export const dynamic = "force-dynamic";

/**
 * GET /api/proxy-test — быстрая проверка: работает ли прокси и видит ли WB.
 * Показывает, какой IP видит сервер и проходит ли запрос к WB.
 */
export async function GET() {
  const proxyUrl = (process.env.WB_PROXY_URL ?? "").trim();
  const useFetch = process.env.WB_USE_FETCH === "1";
  const headless = process.env.WB_HEADLESS !== "0";

  const results: Record<string, unknown> = {
    proxyConfigured: Boolean(proxyUrl),
    proxyUrl: proxyUrl ? proxyUrl.replace(/:([^@:]+)@/, ":***@") : null,
    mode: useFetch ? "fetch" : "playwright",
    headless,
    note:
      "Прокси теперь применяется и к Playwright (режим по умолчанию). " +
      "Для видимого браузера: WB_HEADLESS=0",
  };

  // Тест 1: узнать текущий внешний IP (без прокси)
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(10000),
    });
    const ipData = (await ipRes.json()) as { ip?: string };
    results.currentIp = ipData.ip;
  } catch (e) {
    results.currentIp = `ошибка: ${e instanceof Error ? e.message : "?"}`;
  }

  // Тест 2: проверить WB каталог (через тот же путь, что использует парсер)
  try {
    const { fetchSellerCatalogPage } = await import("@/lib/wb");
    const products = await fetchSellerCatalogPage(12520, 1);
    results.wbAccess = true;
    results.wbProducts = products.length;
    results.wbFirstProduct = products[0]
      ? { nmId: products[0].nmId, name: products[0].name }
      : null;
  } catch (e) {
    results.wbAccess = false;
    results.wbError = e instanceof Error ? e.message : "неизвестная ошибка";
  }

  // Тест 3: если есть прокси — какой IP через него (только HTTP-режим)
  if (proxyUrl) {
    try {
      const { ProxyAgent, fetch: pFetch } = await import("undici");
      const agent = new ProxyAgent(proxyUrl);
      const pRes = await pFetch("https://api.ipify.org?format=json", {
        dispatcher: agent,
        signal: AbortSignal.timeout(15000),
      });
      const pData = (await pRes.json()) as { ip?: string };
      results.proxyIp = pData.ip;
    } catch (e) {
      results.proxyIp = `ошибка: ${e instanceof Error ? e.message : "?"}`;
    }
  }

  return Response.json(results);
}
