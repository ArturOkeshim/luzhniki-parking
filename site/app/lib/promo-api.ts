import { requiredRuntimeValue } from "./config";

export type PromoApiAction =
  | "check"
  | "groups"
  | "bind_vibecode_order"
  | "payment_status"
  | "reserve_vibecode"
  | "redeem_vibecode"
  | "release_vibecode";

export async function promoApiRequest<T extends Record<string, unknown>>(
  action: PromoApiAction,
  body: Record<string, unknown> = {},
): Promise<T> {
  const url = new URL(requiredRuntimeValue("BITRIX_PROMO_API_URL"));
  const token = requiredRuntimeValue("BITRIX_PROMO_API_TOKEN");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Promo-Api-Token": token,
    },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error("Bitrix вернул некорректный ответ промокодов");
  }
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Bitrix отклонил операцию с промокодом"));
  }
  return payload as T;
}
