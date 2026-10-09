export const dynamic = "force-dynamic";

export async function GET() {
  const proxyUrl = (process.env.WB_PROXY_URL ?? "").trim();
  const useFetch = process.env.WB_USE_FETCH === "1";
  const isHeadless = process.env.WB_HEADLESS !== "0";

  const results: Record<string, unknown> = {
    mode: useFetch ? "FETCH" : "PLAYWRIGHT",
    headless: !useFetch ? isHeadless : null,
    proxyConfigured: Boolean(proxyUrl),
    proxyUrl: proxyUrl ? proxyUrl.replace(/:([^@:]+)@/, ":***@") : null,
  };

  // 1. Текущий IP (через fetch)
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json");
    results.directIp = (await ipRes.json()).ip;
  } catch (e) {
    results.directIp = `error: ${e instanceof Error ? e.message : "?"}`;
  }

  // 2. Доступ к WB через основной парсер
  try {
    const { fetchSellerCatalogPage } = await import("@/lib/wb");
    const products = await fetchSellerCatalogPage(12520, 1);
    results.wbAccess = true;
    results.wbItemsFound = products.length;
    if (products[0]) results.sampleItem = products[0].name;
  } catch (e) {
    results.wbAccess = false;
    results.wbError = e instanceof Error ? e.message : String(e);
  }

  return Response.json(results);
}
