/**
 * Синглтон браузера Playwright.
 *
 * - Запускается при первом запросе, живёт пока работает сервер.
 * - Одна страница (tab) на весь процесс — WB не видит параллельных ботов.
 * - Все куки и localStorage сохраняются между запросами (выглядит как реальный пользователь).
 * - Поддерживает WB_PROXY_URL (http://user:pass@host:port) — прокси применяется к браузеру.
 * - Запросы к API идут через page.evaluate(fetch) — как XHR со страницы, а не navigation.
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1366, height: 768 };

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

/** Ждёт, пока другой запрос не освободит браузер (простой mutex) */
async function acquireLock(): Promise<void> {
  let waited = 0;
  while (g.__wbBrowserLock) {
    await sleep(200);
    waited += 200;
    if (waited > 120_000)
      throw new Error("Браузер занят более 2 минут — таймаут");
  }
  g.__wbBrowserLock = true;
}

function releaseLock() {
  g.__wbBrowserLock = false;
}

/** Парсит WB_PROXY_URL в формат Playwright */
function getProxyConfig():
  | { server: string; username?: string; password?: string }
  | undefined {
  const raw = (process.env.WB_PROXY_URL ?? "").trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!u.hostname || !u.port) return undefined;
    const server = `${u.protocol}//${u.hostname}:${u.port}`;
    const cfg: { server: string; username?: string; password?: string } = {
      server,
    };
    if (u.username) cfg.username = decodeURIComponent(u.username);
    if (u.password) cfg.password = decodeURIComponent(u.password);
    return cfg;
  } catch {
    return undefined;
  }
}

async function launchBrowser(): Promise<BrowserState> {
  const headless = process.env.WB_HEADLESS !== "0";
  const proxy = getProxyConfig();

  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-infobars",
      "--window-size=1366,768",
      "--lang=ru-RU",
    ],
  };
  if (proxy) {
    launchOpts.proxy = proxy;
  }

  const browser = await chromium.launch(launchOpts);

  const context = await browser.newContext({
    userAgent: UA,
    viewport: VIEWPORT,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    colorScheme: "light",
    extraHTTPHeaders: {
      "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      "sec-ch-ua":
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
    // Если прокси задан на launch — context его наследует.
    // Дублировать не нужно.
  });

  // Более полный stealth-патч
  await context.addInitScript(() => {
    // webdriver
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // chrome runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = {
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
      app: {},
    };

    // plugins
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ],
    });

    // languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["ru-RU", "ru", "en-US", "en"],
    });

    // permissions
    const originalQuery = window.navigator.permissions.query;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator.permissions as any).query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);

    // WebGL vendor (часто проверяют)
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return "Intel Inc.";
        if (parameter === 37446) return "Intel Iris OpenGL Engine";
        return getParameter.call(this, parameter);
      };
    } catch {
      /* ignore */
    }
  });

  const page = await context.newPage();

  // Первый визит на WB — получаем куки как обычный пользователь
  try {
    await page.goto("https://www.wildberries.ru/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await sleep(1800 + Math.random() * 1200);
    // Лёгкий «человеческий» скролл
    await page.evaluate(() => {
      window.scrollBy(0, 200 + Math.random() * 300);
    });
    await sleep(400 + Math.random() * 600);
  } catch {
    /* если главная не открылась — продолжаем, API-запросы могут работать */
  }

  return { browser, context, page };
}

async function getState(): Promise<BrowserState> {
  if (g.__wbBrowserState) {
    try {
      await g.__wbBrowserState.page.evaluate(() => true);
      return g.__wbBrowserState;
    } catch {
      try {
        await g.__wbBrowserState.browser.close();
      } catch {
        /* ок */
      }
      g.__wbBrowserState = undefined;
    }
  }
  const state = await launchBrowser();
  g.__wbBrowserState = state;
  return state;
}

/**
 * Выполняет fetch внутри страницы браузера (как XHR).
 * Сохраняет cookies/сессию и выглядит естественнее, чем page.goto.
 */
async function inPageFetch(
  page: Page,
  url: string
): Promise<{ status: number; body: string }> {
  return page.evaluate(async (targetUrl) => {
    const res = await fetch(targetUrl, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://www.wildberries.ru/",
        Origin: "https://www.wildberries.ru",
      },
    });
    const body = await res.text();
    return { status: res.status, body };
  }, url);
}

/**
 * Загружает JSON через реальный Chromium.
 * Использует in-page fetch + fallback на navigation.
 */
export async function browserFetchJson(url: string): Promise<unknown> {
  await acquireLock();
  try {
    const { page } = await getState();

    // Реалистичная задержка между запросами (0.6–1.8 с)
    await sleep(600 + Math.random() * 1200);

    let status: number;
    let body: string;

    try {
      const result = await inPageFetch(page, url);
      status = result.status;
      body = result.body;
    } catch {
      // Fallback: navigation (иногда fetch блокируется CSP/CORS)
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (!response) throw new Error("Playwright: пустой ответ");
      status = response.status();
      body = await page.evaluate(() => document.body.innerText);
    }

    if (status === 403 || status === 498) {
      // Прогрев сессии и повтор
      try {
        await page.goto("https://www.wildberries.ru/", {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        await sleep(2500 + Math.random() * 1500);
        await page.evaluate(() => {
          window.scrollBy(0, 150 + Math.random() * 250);
        });
        await sleep(500 + Math.random() * 700);
      } catch {
        /* ignore */
      }

      const retry = await inPageFetch(page, url).catch(async () => {
        const r = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        if (!r) throw new BrowserApiError(status, url);
        const text = await page.evaluate(() => document.body.innerText);
        return { status: r.status(), body: text };
      });

      if (retry.status !== 200) {
        throw new BrowserApiError(retry.status, url);
      }
      status = retry.status;
      body = retry.body;
    } else if (status !== 200) {
      throw new BrowserApiError(status, url);
    }

    // Парсим JSON
    try {
      return JSON.parse(body);
    } catch {
      // Иногда WB оборачивает в <pre> при navigation
      const pre = await page
        .$eval("pre", (el) => el.textContent)
        .catch(() => null);
      if (pre) return JSON.parse(pre);
      throw new Error(`Playwright: не удалось разобрать JSON от ${url}`);
    }
  } finally {
    releaseLock();
  }
}

export class BrowserApiError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(
      status === 403 || status === 498
        ? `WB заблокировал запрос (HTTP ${status}) — даже через браузер. ` +
            `Попробуйте: 1) подождать 10–15 мин, 2) задать WB_PROXY_URL (резидентный РФ), ` +
            `3) WB_HEADLESS=0 (видимый браузер).`
        : `Playwright: WB ответил HTTP ${status}`
    );
    this.status = status;
    this.url = url;
  }
}

/** Закрыть браузер (вызывается при остановке сервера) */
export async function closeBrowser(): Promise<void> {
  if (g.__wbBrowserState) {
    try {
      await g.__wbBrowserState.browser.close();
    } catch {
      /* ок */
    }
    g.__wbBrowserState = undefined;
  }
}
