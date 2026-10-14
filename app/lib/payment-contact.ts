import { entityId, vibeRequest } from "./vibecode";
import { bitrixRestRequest } from "./bitrix";
import { bitrixConfig } from "./config";
import {
  ContactIdentity,
  isSafeContactForIdentity,
  isSameParkingBuyer,
} from "./contact-identity";

type Contact = Record<string, unknown> & { id?: number | string };
type DuplicateContacts = { contact?: Array<number | string>; CONTACT?: Array<number | string> };

async function findContactIds(type: "PHONE" | "EMAIL", value: string): Promise<number[]> {
  const data = await vibeRequest<DuplicateContacts>("/v1/duplicates/find", {
    method: "POST",
    body: { type, values: [value], entityType: "CONTACT" },
  });
  return [...new Set((data.contact ?? data.CONTACT ?? [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
}

async function contactById(id: number): Promise<Contact | null> {
  try {
    const data = await vibeRequest(`/v1/contacts/${id}`, { cache: "no-store" });
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    const contact = record.item && typeof record.item === "object"
      ? (record.item as Contact)
      : (record as Contact);
    if (Number(contact.id ?? contact.ID) !== id) return null;
    return contact;
  } catch {
    return null;
  }
}

async function createParkingContact(identity: ContactIdentity): Promise<number> {
  const created = await vibeRequest("/v1/contacts", {
    method: "POST",
    body: {
      name: identity.firstName,
      lastName: identity.lastName,
      secondName: identity.patronymic,
      phone: identity.phone,
      email: [{ value: identity.email, valueType: "WORK" }],
      opened: false,
      sourceDescription: "Оформление проезда на территорию спортивного комплекса",
    },
  });
  const id = entityId(created);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Контакт Bitrix не создан");
  const verified = await contactById(id);
  if (!verified || !isSafeContactForIdentity(verified, identity)) {
    // Do not try to repair or delete this record: it could have been merged by
    // another CRM process. No deal/payment may use an unverified contact.
    throw new Error("Bitrix не подтвердил отдельный контакт покупателя");
  }
  return id;
}

export async function upsertParkingContact(identity: ContactIdentity): Promise<number> {
  const [phoneIds, emailIds] = await Promise.all([
    findContactIds("PHONE", identity.phone),
    findContactIds("EMAIL", identity.email),
  ]);

  const emailIdSet = new Set(emailIds);
  const candidates = phoneIds.filter((id) => emailIdSet.has(id)).slice(0, 20);
  for (const id of candidates) {
    const contact = await contactById(id);
    if (contact && isSafeContactForIdentity(contact, identity)) return id;
  }

  // При несовпадении, загрязнённых мультиполях или невозможности безопасно
  // проверить карточку создаём отдельный контакт. Существующие контакты не
  // изменяем: так роботам Bitrix неоткуда взять чужой email или телефон.
  return createParkingContact(identity);
}

/** Read-only gate before payment: robots must see exactly this purchase's buyer. */
export async function assertSafeParkingDealContact(
  dealId: number,
  identity: ContactIdentity,
): Promise<void> {
  if (!Number.isSafeInteger(dealId) || dealId <= 0) {
    throw new Error("Некорректный идентификатор сделки");
  }
  const [deal, bindings] = await Promise.all([
    bitrixRestRequest<Record<string, unknown>>("crm.deal.get", { id: dealId }),
    bitrixRestRequest<Array<{ CONTACT_ID?: unknown }>>(
      "crm.deal.contact.items.get", { id: dealId },
    ),
  ]);
  const fullName = [identity.lastName, identity.firstName, identity.patronymic]
    .filter(Boolean).join(" ");
  const contactId = Number(deal?.CONTACT_ID);
  if (Number(deal?.ID) !== dealId ||
      Number(deal?.CATEGORY_ID) !== bitrixConfig.parkingCategoryId ||
      !isSameParkingBuyer(deal, { ...identity, fullName }) ||
      !Number.isSafeInteger(contactId) || contactId <= 0 ||
      !Array.isArray(bindings) || bindings.length !== 1 ||
      Number(bindings[0].CONTACT_ID) !== contactId) {
    throw new Error("Bitrix не подтвердил связь сделки с покупателем");
  }
  const contact = await contactById(contactId);
  if (!contact || !isSafeContactForIdentity(contact, identity)) {
    throw new Error("В сделке обнаружен неоднозначный контакт покупателя");
  }
}
