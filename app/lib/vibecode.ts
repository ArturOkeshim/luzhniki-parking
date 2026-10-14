import { bitrixRestRequest } from "./bitrix";
import { requiredRuntimeValue, runtimeValue } from "./config";

const VIBECODE_ORIGIN = "https://vibecode.bitrix24.tech";

export class VibeCodeError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "VibeCodeError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

function requestBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function nestedEntity(
  value: unknown,
  key: "order" | "payment",
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return record[key] && typeof record[key] === "object" ? record[key] : value;
}

async function localBitrixRequest<T>(
  path: string,
  options: RequestOptions,
): Promise<T> {
  const method = String(options.method ?? "GET").toUpperCase();
  const body = requestBody(options.body);

  if (path === "/v1/duplicates/find" && method === "POST") {
    return await bitrixRestRequest<T>("crm.duplicate.findbycomm", {
      type: body.type,
      values: body.values,
      entity_type: body.entityType,
    });
  }

  const contactMatch = path.match(/^\/v1\/contacts\/(\d+)$/u);
  if (contactMatch && method === "GET") {
    const contact = await bitrixRestRequest<Record<string, unknown>>("crm.contact.get", {
      id: Number(contactMatch[1]),
    });
    return {
      ...contact,
      id: contact.ID,
      name: contact.NAME,
      lastName: contact.LAST_NAME,
      secondName: contact.SECOND_NAME,
      fm: {
        PHONE: contact.PHONE,
        EMAIL: contact.EMAIL,
      },
    } as T;
  }

  if (path === "/v1/contacts" && method === "POST") {
    const email = Array.isArray(body.email)
      ? body.email.map((item) => {
          const entry = requestBody(item);
          return {
            VALUE: entry.value,
            VALUE_TYPE: entry.valueType ?? "WORK",
          };
        })
      : [];
    return await bitrixRestRequest<T>("crm.contact.add", {
      fields: {
        NAME: body.name,
        LAST_NAME: body.lastName,
        SECOND_NAME: body.secondName,
        PHONE: [{ VALUE: body.phone, VALUE_TYPE: "WORK" }],
        EMAIL: email,
        OPENED: body.opened === true ? "Y" : "N",
        SOURCE_DESCRIPTION: body.sourceDescription,
      },
      params: { REGISTER_SONET_EVENT: "Y" },
    });
  }

  if (path === "/v1/orders" && method === "POST") {
    const result = await bitrixRestRequest<unknown>("sale.order.add", {
      fields: body,
    });
    return nestedEntity(result, "order") as T;
  }

  if (path === "/v1/payments" && method === "POST") {
    const result = await bitrixRestRequest<unknown>("sale.payment.add", {
      fields: body,
    });
    return nestedEntity(result, "payment") as T;
  }

  const paymentMatch = path.match(/^\/v1\/payments\/(\d+)$/u);
  if (paymentMatch && method === "GET") {
    return await bitrixRestRequest<T>("sale.payment.get", {
      id: Number(paymentMatch[1]),
    });
  }

  throw new VibeCodeError(`Локальный маршрут Bitrix не поддерживается: ${path}`, 501);
}

export async function vibeRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (runtimeValue("LOCAL_NODE_PREVIEW").toLowerCase() === "true") {
    return localBitrixRequest<T>(path, options);
  }

  const apiKey = requiredRuntimeValue("VIBECODE_API_KEY");
  const response = await fetch(new URL(path, VIBECODE_ORIGIN), {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const error = payload?.error as
      | { message?: string; code?: string }
      | string
      | undefined;
    const message = typeof error === "object"
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
    const code = typeof error === "object" ? error.code : undefined;
    throw new VibeCodeError(
      message || "Bitrix24 временно не ответил",
      response.status,
      code,
    );
  }

  return (payload && "data" in payload ? payload.data : payload) as T;
}

export function entityId(data: unknown): number {
  if (typeof data === "number") return data;
  if (!data || typeof data !== "object") return 0;
  const record = data as Record<string, unknown>;
  const nested = record.item && typeof record.item === "object"
    ? (record.item as Record<string, unknown>)
    : record;
  return Number(nested.id ?? nested.ID ?? 0);
}
