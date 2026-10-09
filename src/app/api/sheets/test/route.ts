import { testConnection, googleCredsConfigured, serviceAccountEmail } from "@/lib/gsheets";
import { extractSheetId } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sheets/test — проверка подключения к Google Sheets.
 * body: { sheetId }
 */
export async function POST(req: Request) {
  if (!googleCredsConfigured()) {
    return Response.json({
      ok: false,
      message:
        "Ключи Google не заданы. Добавьте GOOGLE_SERVICE_ACCOUNT_JSON (или EMAIL + PRIVATE_KEY) в переменные окружения.",
      email: null,
    });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ок */
  }
  const sheetId = extractSheetId(String(body.sheetId ?? ""));
  const result = await testConnection(sheetId);
  return Response.json({ ...result, email: serviceAccountEmail() });
}
