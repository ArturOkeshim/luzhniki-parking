type ContactRecord = Record<string, unknown>;

export type ContactIdentity = {
  firstName: string;
  lastName: string;
  patronymic: string;
  phone: string;
  email: string;
};

function record(value: unknown): ContactRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ContactRecord)
    : null;
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D+/gu, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return digits;
}

function entryValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const item = record(value);
  return item ? String(item.value ?? item.VALUE ?? "") : "";
}

function uniqueNormalized(values: unknown[], normalize: (value: unknown) => string): string[] {
  return [...new Set(values.map(entryValue).map(normalize).filter(Boolean))];
}

function multifieldValues(
  contact: ContactRecord,
  type: "EMAIL" | "PHONE",
): unknown[] | null {
  const fm = contact.fm ?? contact.FM;
  if (fm === undefined || fm === null) return null;

  const grouped = record(fm);
  if (grouped) {
    const values = grouped[type];
    return Array.isArray(values) ? values : values === undefined ? [] : [values];
  }

  if (!Array.isArray(fm)) return null;
  if (fm.some((value) => {
    const item = record(value);
    return !item || !String(item.typeId ?? item.TYPE_ID ?? item.type ?? "").trim();
  })) return null;
  return fm.filter((value) => {
    const item = record(value);
    if (!item) return false;
    const itemType = String(item.typeId ?? item.TYPE_ID ?? item.type ?? "").toUpperCase();
    return itemType === type;
  });
}

/**
 * Existing contacts are reused only when their complete CRM multifields are
 * available and contain exactly this one buyer. A polluted or ambiguous
 * contact is deliberately rejected so Bitrix robots cannot pick somebody
 * else's last email address or phone number.
 */
export function isSafeContactForIdentity(
  contact: ContactRecord,
  identity: ContactIdentity,
): boolean {
  if (!normalizeName(identity.firstName) || !normalizeName(identity.lastName) ||
      !normalizeEmail(identity.email) || !normalizePhone(identity.phone)) return false;
  const emailEntries = multifieldValues(contact, "EMAIL");
  const phoneEntries = multifieldValues(contact, "PHONE");
  if (emailEntries === null || phoneEntries === null) return false;
  if (emailEntries.some((value) => !normalizeEmail(entryValue(value))) ||
      phoneEntries.some((value) => !normalizePhone(entryValue(value)))) return false;

  const emails = uniqueNormalized(emailEntries, normalizeEmail);
  const phones = uniqueNormalized(phoneEntries, normalizePhone);
  if (
    emails.length !== 1 ||
    phones.length !== 1 ||
    emails[0] !== normalizeEmail(identity.email) ||
    phones[0] !== normalizePhone(identity.phone)
  ) {
    return false;
  }

  return (
    normalizeName(contact.name ?? contact.NAME) === normalizeName(identity.firstName) &&
    normalizeName(contact.lastName ?? contact.LAST_NAME) === normalizeName(identity.lastName) &&
    normalizeName(contact.secondName ?? contact.SECOND_NAME) === normalizeName(identity.patronymic)
  );
}

/** A pending purchase belongs to the full buyer snapshot, not just a payer's email. */
export function isSameParkingBuyer(
  deal: ContactRecord,
  buyer: { fullName: string; email: string; phone: string },
): boolean {
  return Boolean(normalizeName(buyer.fullName) && normalizeEmail(buyer.email) &&
    normalizePhone(buyer.phone)) &&
    normalizeName(deal.UF_CRM_PARKING_FULL_NAME) === normalizeName(buyer.fullName) &&
    normalizeEmail(deal.UF_CRM_PARKING_EMAIL) === normalizeEmail(buyer.email) &&
    normalizePhone(deal.UF_CRM_PARKING_PHONE) === normalizePhone(buyer.phone);
}
