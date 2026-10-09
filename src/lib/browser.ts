/**
 * Улучшенный синглтон браузера Playwright.
 * 
 * Особенности:
 * - Усиленный Stealth (маскировка под человека).
 * - Поддержка прокси (WB_PROXY_URL) прямо в контексте браузера.
 * - In-page fetch: запросы к API идут через JS-код страницы (самый надежный метод).
 * - WB_HEADLESS=0 для запуска в видимом режиме.
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

async function launchBrowser(): Promise<BrowserState> {
  const proxyUrl = process.env.WB_PROXY_URL;
  const isHeadless = process.env.WB_HEADLESS !== "0";

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    // Передаем прокси в Playwright если он задан
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });

  // Stealth: маскируем webdriver и платформу
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = { runtime: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).languages = ["ru-RU", "ru", "en-US", "en"];
  });

  const page = await context.newPage();
  
  // Устанавливаем куки и "прогреваем" сессию
  await page.goto("https://www.wildberries.ru/", { waitUntil: "domcontentloaded" });
  await sleep(1000);

  return { browser, context, page };
}

async function getState(): Promise<BrowserState> {
  if (g.__wbBrowserState) {
    try {
      await g.__wbBrowserState.page.evaluate(() => true);
      return g.__wbBrowserState;
    } catch {
      g.__wbBrowserState = undefined;
    }
  }
  const state = await launchBrowser();
  g.__wbBrowserState = state;
  return state;
}

/**
 * Выполняет fetch запрос ВНУТРИ страницы браузера.
 * Это позволяет избежать многих проверок антибота.
 */
export async function browserFetchJson(url: string): Promise<unknown> {
  await acquireLock();
  try {
    const { page } = await getState();
    
    // Эмуляция случайной активности перед запросом
    if (Math.random() > 0.7) {
      await page.mouse.move(Math.random() * 500, Math.random() * 500);
    }

    // Делаем запрос через page.evaluate с проверкой контента
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await page.evaluate(async (targetUrl: string) => {
      const response = await fetch(targetUrl, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9",
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text || text.trim() === "") throw new Error("EMPTY_RESPONSE");
      try {
        return JSON.parse(text);
      } catch (e) {
        if (text.includes("<html") || text.includes("<body")) throw new Error("HTML_INSTEAD_OF_JSON");
        throw new Error(`INVALID_JSON: ${text.slice(0, 50)}`);
      }
    }, url);

    return result;
  } catch (e: any) {
    const msg = e?.message || String(e);

    // Если fetch внутри страницы не сработал (пусто или HTML) — пробуем обычный goto
    if (msg.includes("EMPTY_RESPONSE") || msg.includes("HTML_INSTEAD_OF_JSON") || msg.includes("INVALID_JSON")) {
      const { page } = await getState();
      await page.goto(url, { 
        waitUntil: "domcontentloaded",
        timeout: 25000 
      });
      // Ждем немного, чтобы JS отработал
      await sleep(1000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      try {
        return JSON.parse(bodyText);
      } catch {
        // Если внутри HTML, попробуем вытащить JSON из тега pre
        const preText = await page.$eval("pre", el => el.textContent).catch(() => null);
        if (preText) return JSON.parse(preText);
        throw new Error(`WB_BLOCK: Сервер прислал не данные, а заглушку. Возможно, нужно решить капчу в открывшемся окне.`);
      }
    }

    if (msg.includes("HTTP 403") || msg.includes("HTTP 498")) {
      // При 403 пробуем один раз "прогреть" главную страницу
      const { page } = await getState();
      await page.goto("https://www.wildberries.ru/", { waitUntil: "networkidle" });
      await page.evaluate(() => window.scrollTo(0, 500));
      await sleep(2000);
      
      // Повторный запрос после прогрева
      return page.evaluate(async (targetUrl: string) => {
        const response = await fetch(targetUrl);
        return response.json();
      }, url);
    }
    throw e;
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
