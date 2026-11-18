import { bitrixRestRequest } from "./bitrix";
import { bitrixConfig } from "./config";
import { normalizeRussianPlate } from "./parking-plate";
import { vibeRequest } from "./vibecode";

const FINE_PLATE_FIELD = "ufCrm_6A428CDD7BD93";
const FINE_AMOUNT_FIELD = "ufCrm18FineAmount";
const PAID_FINE_STAGES = new Set([
  "DT1112_71:SUCCESS",
  "DT1112_67:UC_PAID_FINE",
]);

const FINE_AMOUNT_ENUM_VALUES: Record<number, number> = {
  583: 5000,
  584: 10000,
  585: 25000,
  586: 10,
};

export type ParkingFine = Record<string, unknown> & {
  id?: number | string;
  stageId?: string;
  opportunity?: number | string;
};

function asEntityList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["items", "entities", "results", "result"]) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

function readField(item: ParkingFine, field: string): unknown {
  if (field in item) return item[field];
  const upper = field.replace(/^ufCrm/u, "UF_CRM_").toUpperCase();
  return item[upper];
}

function itemPlate(item: ParkingFine): string {
  return normalizeRussianPlate(readField(item, FINE_PLATE_FIELD));
}

export function isOutstandingParkingFine(item: ParkingFine): boolean {
  return !PAID_FINE_STAGES.has(String(item.stageId ?? ""));
}

export function parkingFineAmount(item: ParkingFine): number {
  const opportunity = Number(item.opportunity ?? 0);
  if (opportunity > 0) return opportunity;

  const raw = readField(item, FINE_AMOUNT_FIELD);
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return value > 0 ? (FINE_AMOUNT_ENUM_VALUES[value] ?? value) : 0;
}

function listPath(plate: string): string {
  const query = new URLSearchParams();
  query.set("filter[categoryId]", String(bitrixConfig.finesCategoryId));
  query.set(`filter[${FINE_PLATE_FIELD}]`, plate);
  query.set("limit", "100");
  return `/v1/items/${bitrixConfig.entityTypeId}?${query.toString()}`;
}

async function listViaBitrix(plate: string): Promise<ParkingFine[]> {
  const result = await bitrixRestRequest<{ items?: ParkingFine[] }>("crm.item.list", {
    entityTypeId: bitrixConfig.entityTypeId,
    filter: {
      categoryId: bitrixConfig.finesCategoryId,
      [FINE_PLATE_FIELD]: plate,
    },
    select: ["*", "ufCrm_*"],
  });
  return result.items ?? [];
}

export async function listParkingFinesByPlate(value: unknown): Promise<ParkingFine[]> {
  const plate = normalizeRussianPlate(value);
  let items: ParkingFine[];

  try {
    items = asEntityList<ParkingFine>(
      await vibeRequest(listPath(plate), { cache: "no-store" }),
    );
  } catch (error) {
    console.error(
      "PARKING_SUBSCRIPTION_FINE_CHECK_VIBECODE_FALLBACK",
      error instanceof Error ? error.message : String(error),
    );
    items = await listViaBitrix(plate);
  }

  return items.filter((item) => itemPlate(item) === plate);
}

export function parkingFinesPaymentUrl(plate: string): string {
  const url = new URL(bitrixConfig.finesPaymentUrl);
  if (url.protocol !== "https:") {
    throw new Error("Некорректная настройка FINES_PAYMENT_URL");
  }
  url.searchParams.set("plate", normalizeRussianPlate(plate));
  return url.toString();
}
