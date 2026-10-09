import { getAutomation } from "@/lib/settings";
import { runPipeline } from "@/lib/pipeline";

/**
 * Встроенный планировщик: раз в минуту проверяет настройки и, если подошло
 * время, запускает пайплайн «парсинг → выгрузка в Sheets».
 * Работает, пока жив nodejs-процесс (self-host / PM2 / docker).
 * На serverless-хостингах используйте внешний cron: /api/cron/run.
 */

const TICK_MS = 60_000;

const g = globalThis as typeof globalThis & {
  __sppRadarTimer?: ReturnType<typeof setInterval>;
  __sppRadarRunning?: boolean;
};

async function tick() {
  if (g.__sppRadarRunning) return; // защита от наложения прогонов
  try {
    const cfg = await getAutomation();
    if (!cfg.enabled) return;
    const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
    const due = Date.now() - last >= cfg.intervalHours * 3_600_000;
    if (!due) return;

    g.__sppRadarRunning = true;
    console.info(
      `[scheduler] запуск пайплайна: продавец ${cfg.supplier}, интервал ${cfg.intervalHours} ч`
    );
    const res = await runPipeline({ trigger: "schedule" });
    console.info(
      `[scheduler] завершено: ok=${res.ok}, SKU=${res.parse?.found ?? 0}, sheets=${res.export?.reportRows ?? 0}`
    );
  } catch (e) {
    console.error("[scheduler] ошибка тика:", e);
  } finally {
    g.__sppRadarRunning = false;
  }
}

export function startScheduler() {
  if (g.__sppRadarTimer) return;
  g.__sppRadarTimer = setInterval(tick, TICK_MS);
  g.__sppRadarTimer.unref?.();
  const boot = setTimeout(tick, 20_000);
  boot.unref?.();
  console.info("[scheduler] планировщик запущен (тик каждые 60 c)");
}
