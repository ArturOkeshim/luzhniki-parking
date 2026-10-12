type RuntimeBindings = Record<string, string | undefined>;

let workerBindings: RuntimeBindings = {};

export function setRuntimeBindings(
  value: Record<string, unknown> | null | undefined,
): void {
  workerBindings = Object.fromEntries(
    Object.entries(value ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function bindings(): RuntimeBindings {
  return {
    ...process.env,
    ...workerBindings,
  };
}

export function runtimeValue(name: string, fallback = ""): string {
  const value = bindings()[name] ?? process.env[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

export function requiredRuntimeValue(name: string): string {
  const value = runtimeValue(name);
  if (!value) {
    throw new Error(`Отсутствует обязательная настройка ${name}`);
  }
  return value;
}

export const bitrixConfig = {
  get portalHost() {
    return runtimeValue("B24_PORTAL_HOST", "crm.luzhniki.ru").toLowerCase();
  },
  get parkingCategoryId() {
    return Number(runtimeValue("B24_PARKING_CATEGORY_ID", "40"));
  },
  get parkingDraftStageId() {
    return runtimeValue("B24_PARKING_DRAFT_STAGE_ID");
  },
  get parkingAwaitingStageId() {
    return runtimeValue("B24_PARKING_AWAITING_STAGE_ID");
  },
  get parkingPaidStageId() {
    return runtimeValue("B24_PARKING_PAID_STAGE_ID");
  },
  get personTypeId() {
    return Number(runtimeValue("B24_PERSON_TYPE_ID", "3"));
  },
  get paySystemId() {
    return Number(runtimeValue("B24_PAY_SYSTEM_ID", "24"));
  },
  get responsibleId() {
    return Number(runtimeValue("B24_PARKING_RESPONSIBLE_ID", "85396"));
  },
  get paymentTtlSeconds() {
    return Number(runtimeValue("PARKING_PAYMENT_TTL_SECONDS", "900"));
  },
};
