/**
 * Максимально "человечный" браузерный клиент.
 * 
 * Если обычный fetch не проходит, он буквально переходит по ссылке
 * и ждет появления данных на экране. Это позволяет пользователю
 * самому решить капчу, если она появится.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface BrowserState {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const g = globalThis as typeof globalThis & {
  __wbBrowserState?: BrowserState;
  __wbBrowserLock?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MANUAL_WAIT_MS = Number(process.env.WB_MANUAL_WAIT_MS ?? 0) || 0;

async function acquireLock(): Promise<void> {
  let waited = 0;
  while (g.__wbBrowserLock) {
    await sleep(200);
    waited += 200;
    if (waited > 120_000) throw new Error("Браузер занят (timeout)");
  }
  g.__wbBrowserLock = true;
}

function releaseLock() {
  g.__wbBrowserLock = false;
}

async function acceptCookies(page: Page): Promise<boolean> {
  try {
    const cookieBtn = await page.locator("button:has-text('Окей'), button:has-text('OK'), .cookie-banner__btn").first();
    if (await cookieBtn.isVisible({ timeout: 2000 })) {
      await cookieBtn.click();
      return true;
    }
  } catch { /* ок */ }
  return false;
}

async function warmMainPage(page: Page): Promise<void> {
  await page.goto("https://www.wildberries.ru/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1000);
  await acceptCookies(page);
  if (MANUAL_WAIT_MS > 0) await sleep(MANUAL_WAIT_MS);
}

async function launchBrowser(): Promise<BrowserState> {
  const proxyUrl = (process.env.WB_PROXY_URL ?? "").trim();
  const isHeadless = process.env.WB_HEADLESS !== "0";

  let proxyConfig;
  if (proxyUrl) {
    try {
      const p = new URL(proxyUrl);
      proxyConfig = {
        server: `${p.protocol}//${p.hostname}:${p.port}`,
        username: decodeURIComponent(p.username),
        password: decodeURIComponent(p.password),
      };
    } catch { proxyConfig = { server: proxyUrl }; }
  }

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    proxy: proxyConfig,
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
  });

  const page = await context.newPage();
  await warmMainPage(page).catch(() => {});
  return { browser, context, page };
}

async function getState(): Promise<BrowserState> {
  if (g.__wbBrowserState) {
    try {
      await g.__wbBrowserState.page.evaluate(() => true);
      return g.__wbBrowserState;
    } catch { g.__wbBrowserState = undefined; }
  }
  const state = await launchBrowser();
  g.__wbBrowserState = state;
  return state;
}

/**
 * Главная функция получения данных.
 * Пробует fetch, а если 403 - переходит по ссылке.
 */
export async function browserFetchJson(url: string): Promise<unknown> {
  await acquireLock();
  try {
    const { page } = await getState();

    // Метод 1: In-page fetch (быстро)
    try {
      const res = await page.evaluate(async (targetUrl) => {
        const r = await fetch(targetUrl);
        if (!r.ok) return { error: r.status, text: await r.text() };
        return { data: await r.json() };
      }, url);

      if ((res as any).data) return (res as any).data;
      // Если получили 403 - не падаем, идем к Методу 2
    } catch { /* ошибка парсинга или сети - идем к Методу 2 */ }

    // Метод 2: Навигация (надежно)
    // Буквально открываем URL в браузере
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    
    // Ждем, пока на странице появится JSON (или пока пользователь решит капчу)
    let attempts = 0;
    while (attempts < 10) {
      const content = await page.evaluate(() => document.body.innerText);
      if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
        try {
          return JSON.parse(content);
        } catch { /* ждем дальше */ }
      }
      
      // Если видим признаки 403 или капчи - ждем дольше
      if (content.includes("403") || content.includes("robot") || content.includes("капч")) {
        await sleep(2000);
      } else {
        await sleep(1000);
      }
      attempts++;
    }

    throw new Error("Не удалось получить JSON даже после навигации. Проверьте окно браузера.");
  } finally {
    releaseLock();
  }
}

export async function closeBrowser() {
  if (g.__wbBrowserState) {
    await g.__wbBrowserState.browser.close();
    g.__wbBrowserState = undefined;
  }
}
