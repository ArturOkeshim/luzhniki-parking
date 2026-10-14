import { bitrixConfig, requiredRuntimeValue } from "./config";

type BitrixEnvelope<T> = {
  result?: T;
  error?: string;
  error_description?: string;
};

function webhookMethodUrl(method: string): URL {
  const rawWebhook = requiredRuntimeValue("B24_WEBHOOK_URL");
  const webhook = new URL(rawWebhook.endsWith("/") ? rawWebhook : `${rawWebhook}/`);
  if (
    webhook.protocol !== "https:" ||
    webhook.hostname.toLowerCase() !== bitrixConfig.portalHost ||
    !/^\/rest\/\d+\/[^/]+\/$/u.test(webhook.pathname)
  ) {
    throw new Error("Некорректная настройка B24_WEBHOOK_URL");
  }
  return new URL(`${method}.json`, webhook);
}

function appendFormValue(
  form: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendFormValue(form, `${key}[${index}]`, entry));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([nestedKey, entry]) =>
      appendFormValue(form, `${key}[${nestedKey}]`, entry));
    return;
  }
  form.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}

export async function bitrixRestRequest<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendFormValue(form, key, value));
  const response = await fetch(webhookMethodUrl(method), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  let payload: BitrixEnvelope<T>;
  try {
    payload = JSON.parse(raw) as BitrixEnvelope<T>;
  } catch {
    throw new Error("Bitrix REST вернул некорректный ответ");
  }
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || "Ошибка Bitrix REST");
  }
  return payload.result as T;
}

function checkedPaymentUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== bitrixConfig.paymentPublicHost
  ) {
    throw new Error("Bitrix24 вернул некорректную ссылку на оплату");
  }
  return url.toString();
}

export async function getPublicPaymentUrl(paymentId: number): Promise<string> {
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    throw new Error("Некорректный идентификатор платежа");
  }
  try {
    const result = await bitrixRestRequest<{
      payment?: { url?: unknown; shortUrl?: unknown };
    }>("salescenter.payment.getPublicUrl", { id: paymentId });
    return checkedPaymentUrl(result?.payment?.url) || checkedPaymentUrl(result?.payment?.shortUrl);
  } catch {
    return "";
  }
}
