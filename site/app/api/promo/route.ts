import { NextRequest, NextResponse } from "next/server";
import { runtimeValue } from "@/app/lib/config";

export const dynamic = "force-dynamic";

type PromoBody = {
  action?: "check";
  code?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/gu, "");
}

export async function GET() {
  const configured = Boolean(
    runtimeValue("BITRIX_PROMO_API_URL") &&
      runtimeValue("BITRIX_PROMO_API_TOKEN"),
  );
  return json({ configured, mode: configured ? "bitrix" : "offline" });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PromoBody;
    const action = body.action;
    const code = normalizeCode(body.code);

    if (action !== "check") {
      return json({ error: "Неизвестное действие." }, 400);
    }
    if (!code) return json({ error: "Введите промокод." }, 400);

    const url = runtimeValue("BITRIX_PROMO_API_URL");
    const token = runtimeValue("BITRIX_PROMO_API_TOKEN");
    if (!url || !token) {
      return json({ error: "Связь с сервером Bitrix не настроена." }, 503);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Promo-Api-Token": token,
      },
      body: JSON.stringify({ action, code }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "Bitrix вернул некорректный ответ." }, 502);
    }
    return json(payload, response.status);
  } catch {
    return json({ error: "Не удалось проверить промокод." }, 502);
  }
}
