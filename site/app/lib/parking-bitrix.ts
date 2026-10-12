import { bitrixRestRequest } from "./bitrix";
import { bitrixConfig } from "./config";
import { ParkingTariffId } from "./parking-tariffs";
import { promoApiRequest } from "./promo-api";
import { entityId, vibeRequest } from "./vibecode";

type StageRow = {
  STATUS_ID?: string;
  NAME?: string;
  SORT?: number | string;
};

type StageSet = {
  draft: string;
  awaiting: string;
  paid: string;
};

type GroupsPayload = {
  productIds?: Record<string, number | string>;
};

type ReusableDealRow = {
  ID?: number | string;
  OPPORTUNITY?: number | string;
  UF_CRM_6A427BE0EA767?: unknown;
  UF_CRM_PROMO_CODE?: unknown;
  UF_CRM_PARKING_EMAIL?: unknown;
  UF_CRM_PARKING_PAYMENT_ID?: unknown;
  UF_CRM_PARKING_PAYMENT_URL?: unknown;
  UF_CRM_PARKING_PAYMENT_EXPIRES_AT?: unknown;
  UF_CRM_PARKING_PAYMENT_CONFIRMED?: unknown;
};

type SaleBasketRow = {
  id?: number | string;
  productId?: number | string;
  module?: unknown;
  type?: number | string | null;
  price?: number | string;
  quantity?: number | string;
  currency?: unknown;
};

type SaleOrderRow = {
  price?: number | string;
};

type OrderPropertyValue = {
  code?: unknown;
  orderPropsId?: unknown;
  value?: unknown;
};

type DealUserField = {
  FIELD_NAME?: unknown;
  LIST?: Array<{
    ID?: unknown;
    VALUE?: unknown;
    XML_ID?: unknown;
  }>;
};

export type ReusableParkingPayment = {
  dealId: number;
  orderId: number;
  paymentId: number;
  paymentUrl: string;
  expiresAt: number;
};

export type ParkingOrderInput = {
  contactId: number;
  fullName: string;
  email: string;
  phone: string;
  plate: string;
  foreignPlate: boolean;
  startDate: string;
  tariffId: ParkingTariffId;
  tariffName: string;
  rateId: number;
  days: string;
  limit: string;
  accessHours: string;
  eligibility: string;
  durationDays: number;
  price: number;
  promoCode: string;
  promoGroup: string;
  personalDataConsent: boolean;
  offerAccepted: boolean;
  marketingConsent: boolean;
};

let stagesPromise: Promise<StageSet> | null = null;
let productsPromise: Promise<Record<string, number>> | null = null;
const consentValuePromises = new Map<string, Promise<number>>();

async function parkingConsentValue(
  fieldName: string,
  accepted: boolean,
): Promise<number> {
  const cacheKey = `${fieldName}:${accepted ? "yes" : "no"}`;
  const cached = consentValuePromises.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const rows = await bitrixRestRequest<DealUserField[]>("crm.deal.userfield.list", {
      filter: { FIELD_NAME: fieldName },
    });
    const field = Array.isArray(rows)
      ? rows.find((row) => String(row.FIELD_NAME ?? "") === fieldName)
      : undefined;
    const suffix = accepted ? "_YES" : "_NO";
    const expectedValue = accepted ? "да" : "нет";
    const option = (field?.LIST ?? []).find((item) => {
      const xmlId = String(item.XML_ID ?? "").trim().toUpperCase();
      const value = String(item.VALUE ?? "").trim().toLowerCase();
      return xmlId.endsWith(suffix) || value === expectedValue;
    });
    const id = Number(option?.ID ?? 0);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`В Bitrix не найдено значение согласия ${fieldName}`);
    }
    return id;
  })();
  consentValuePromises.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    consentValuePromises.delete(cacheKey);
    throw error;
  }
}

function resultId(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") return Number(value);
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  return Number(record.id ?? record.ID ?? record.result ?? 0);
}

async function resolveStages(): Promise<StageSet> {
  if (stagesPromise) return stagesPromise;
  stagesPromise = (async () => {
    const entityId = `DEAL_STAGE_${bitrixConfig.parkingCategoryId}`;
    const rows = await bitrixRestRequest<StageRow[]>("crm.status.list", {
      order: { SORT: "ASC" },
      filter: { ENTITY_ID: entityId },
    });
    const ordered = [...(Array.isArray(rows) ? rows : [])].sort(
      (left, right) => Number(left.SORT ?? 0) - Number(right.SORT ?? 0),
    );
    const byName = (name: string) =>
      String(ordered.find((row) => String(row.NAME ?? "").trim() === name)?.STATUS_ID ?? "");
    const draft = bitrixConfig.parkingDraftStageId || String(ordered[0]?.STATUS_ID ?? "");
    const awaiting = bitrixConfig.parkingAwaitingStageId || byName("Ожидает оплаты");
    const paid = bitrixConfig.parkingPaidStageId || byName("Оплачено");
    if (!draft || !awaiting || !paid) {
      throw new Error("В воронке Bitrix не найдены стадии оформления абонемента");
    }
    return { draft, awaiting, paid };
  })();
  try {
    return await stagesPromise;
  } catch (error) {
    stagesPromise = null;
    throw error;
  }
}

async function productIds(): Promise<Record<string, number>> {
  if (productsPromise) return productsPromise;
  productsPromise = promoApiRequest<GroupsPayload>("groups").then((payload) =>
    Object.fromEntries(
      Object.entries(payload.productIds ?? {}).map(([group, id]) => [group, Number(id)]),
    ),
  );
  try {
    return await productsPromise;
  } catch (error) {
    productsPromise = null;
    throw error;
  }
}

export async function parkingProductId(group: string): Promise<number> {
  const id = Number((await productIds())[group] ?? 0);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Для тарифа ${group} не настроен товар Bitrix`);
  }
  return id;
}

export async function findReusableParkingPayment(input: {
  promoCode: string;
  plate: string;
  email: string;
  price: number;
}): Promise<ReusableParkingPayment | null> {
  if (!input.promoCode) return null;
  const rows = await bitrixRestRequest<ReusableDealRow[]>("crm.deal.list", {
    order: { ID: "DESC" },
    filter: {
      CATEGORY_ID: bitrixConfig.parkingCategoryId,
      UF_CRM_PROMO_CODE: input.promoCode,
    },
    select: [
      "ID",
      "OPPORTUNITY",
      "UF_CRM_6A427BE0EA767",
      "UF_CRM_PROMO_CODE",
      "UF_CRM_PARKING_EMAIL",
      "UF_CRM_PARKING_PAYMENT_ID",
      "UF_CRM_PARKING_PAYMENT_URL",
      "UF_CRM_PARKING_PAYMENT_EXPIRES_AT",
      "UF_CRM_PARKING_PAYMENT_CONFIRMED",
    ],
    start: 0,
  });
  const expectedEmail = input.email.trim().toLowerCase();
  const row = (Array.isArray(rows) ? rows : []).find((candidate) =>
    String(candidate.UF_CRM_PROMO_CODE ?? "").trim().toUpperCase() === input.promoCode &&
    String(candidate.UF_CRM_6A427BE0EA767 ?? "").trim().toUpperCase() === input.plate &&
    String(candidate.UF_CRM_PARKING_EMAIL ?? "").trim().toLowerCase() === expectedEmail &&
    Number(candidate.OPPORTUNITY ?? 0) === input.price &&
    Number(candidate.UF_CRM_PARKING_PAYMENT_CONFIRMED ?? 0) !== 1
  );
  if (!row) return null;
  const dealId = Number(row.ID ?? 0);
  const paymentId = Number(row.UF_CRM_PARKING_PAYMENT_ID ?? 0);
  const expiresAt = Date.parse(String(row.UF_CRM_PARKING_PAYMENT_EXPIRES_AT ?? ""));
  if (!dealId || !paymentId || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    return null;
  }
  const payment = await parkingPaymentState(paymentId);
  if (payment.paid || !payment.orderId) return null;
  return {
    dealId,
    orderId: payment.orderId,
    paymentId,
    paymentUrl: String(row.UF_CRM_PARKING_PAYMENT_URL ?? "").trim(),
    expiresAt,
  };
}

export async function createParkingDeal(input: ParkingOrderInput): Promise<number> {
  const stages = await resolveStages();
  const [personalDataConsent, offerAccepted, marketingConsent] = await Promise.all([
    parkingConsentValue("UF_CRM_PARKING_PD_CONSENT", input.personalDataConsent),
    parkingConsentValue("UF_CRM_PARKING_OFFER_ACCEPTED", input.offerAccepted),
    parkingConsentValue("UF_CRM_PARKING_MARKETING_CONSENT", input.marketingConsent),
  ]);
  const title = `Проезд на территорию · ${input.plate} · ${input.fullName}`;
  const result = await bitrixRestRequest<unknown>("crm.deal.add", {
    fields: {
      TITLE: title,
      CATEGORY_ID: bitrixConfig.parkingCategoryId,
      STAGE_ID: stages.draft,
      TYPE_ID: "SERVICES",
      OPPORTUNITY: input.price,
      CURRENCY_ID: "RUB",
      CONTACT_ID: input.contactId,
      ASSIGNED_BY_ID: bitrixConfig.responsibleId,
      OPENED: "N",
      BEGINDATE: input.startDate,
      UF_CRM_6A427BE0EA767: input.plate,
      UF_CRM_DEAL_1782746372939: input.startDate,
      UF_CRM_PROMO_CODE: input.promoCode,
      UF_CRM_PROMO_APPLIED: input.promoCode ? 1 : 0,
      UF_CRM_DEAL_SRCTYPE: input.tariffName,
      UF_CRM_PARKING_FULL_NAME: input.fullName,
      UF_CRM_PARKING_PHONE: input.phone,
      UF_CRM_PARKING_EMAIL: input.email,
      UF_CRM_PARKING_TARIFF: input.tariffName,
      UF_CRM_PARKING_RATE_ID: input.rateId,
      UF_CRM_PARKING_DAYS: input.days,
      UF_CRM_PARKING_LIMIT: input.limit,
      UF_CRM_PARKING_ACCESS_HOURS: input.accessHours,
      UF_CRM_PARKING_ELIGIBILITY: input.eligibility,
      UF_CRM_PARKING_DURATION_DAYS: input.durationDays,
      UF_CRM_PARKING_PD_CONSENT: personalDataConsent,
      UF_CRM_PARKING_OFFER_ACCEPTED: offerAccepted,
      UF_CRM_PARKING_MARKETING_CONSENT: marketingConsent,
      UF_CRM_PARKING_PROMO_GROUP: input.promoGroup,
      UF_CRM_PARKING_PAYMENT_EXPIRED: 0,
      UF_CRM_PARKING_NOTIFICATIONS_SENT: 0,
      UF_CRM_PARKING_PAYMENT_CONFIRMED: 0,
    },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
  const dealId = resultId(result);
  if (!dealId) throw new Error("Сделка Bitrix не создана");
  return dealId;
}

async function parkingOrderPropertyValues(orderId: number): Promise<OrderPropertyValue[]> {
  const result = await bitrixRestRequest<{ propertyValues?: OrderPropertyValue[] }>(
    "sale.propertyvalue.list",
    {
      select: ["code", "orderId", "orderPropsId", "value"],
      filter: { "=orderId": orderId },
      order: { id: "asc" },
    },
  );
  return Array.isArray(result?.propertyValues) ? result.propertyValues : [];
}

export async function setParkingOrderBuyerProperties(
  orderId: number,
  buyer: { fullName: string; email: string; phone: string },
): Promise<void> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("Некорректный идентификатор заказа");
  }
  const target: Record<string, string> = {
    FIO: buyer.fullName.trim(),
    EMAIL: buyer.email.trim(),
    PHONE: buyer.phone.trim(),
  };
  if (!target.FIO || !target.EMAIL || !target.PHONE) {
    throw new Error("Не заполнены реквизиты покупателя");
  }

  const current = await parkingOrderPropertyValues(orderId);
  for (const code of Object.keys(target)) {
    if (!current.some((item) => String(item.code ?? "").trim().toUpperCase() === code)) {
      throw new Error(`В заказе отсутствует свойство ${code}`);
    }
  }
  const propertyValues = current.map((item) => {
    const code = String(item.code ?? "").trim().toUpperCase();
    const orderPropsId = Number(item.orderPropsId ?? 0);
    if (!Number.isInteger(orderPropsId) || orderPropsId <= 0) {
      throw new Error("Bitrix вернул некорректное свойство заказа");
    }
    return {
      orderPropsId,
      value: target[code] ?? String(item.value ?? ""),
    };
  });

  await bitrixRestRequest("sale.propertyvalue.modify", {
    fields: { order: { id: orderId, propertyValues } },
  });

  const verified = await parkingOrderPropertyValues(orderId);
  for (const [code, expected] of Object.entries(target)) {
    const saved = verified.find(
      (item) => String(item.code ?? "").trim().toUpperCase() === code,
    );
    if (String(saved?.value ?? "").trim() !== expected) {
      throw new Error(`Bitrix не подтвердил свойство заказа ${code}`);
    }
  }
}

export async function setParkingDealProduct(
  dealId: number,
  productId: number,
  productName: string,
  price: number,
): Promise<void> {
  if (!Number.isInteger(dealId) || dealId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    throw new Error("Некорректные данные товара сделки");
  }
  await bitrixRestRequest("crm.deal.productrows.set", {
    id: dealId,
    rows: [
      {
        PRODUCT_ID: productId,
        PRODUCT_NAME: productName,
        PRICE: price,
        QUANTITY: 1,
        CURRENCY_ID: "RUB",
      },
    ],
  });
  const rows = await bitrixRestRequest<Array<{
    PRODUCT_ID?: number | string;
    PRICE?: number | string;
    QUANTITY?: number | string;
  }>>("crm.deal.productrows.get", { id: dealId });
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    Number(rows[0]?.PRODUCT_ID ?? 0) !== productId ||
    Number(rows[0]?.PRICE ?? 0) !== price ||
    Number(rows[0]?.QUANTITY ?? 0) !== 1
  ) {
    throw new Error("Bitrix не подтвердил товар в сделке");
  }
}

export async function createParkingPayment(input: {
  dealId: number;
  productId: number;
  productName: string;
  price: number;
  plate: string;
}): Promise<{ orderId: number; paymentId: number; expiresAt: number }> {
  const order = await vibeRequest("/v1/orders", {
    method: "POST",
    body: {
      lid: "s1",
      personTypeId: bitrixConfig.personTypeId,
      currency: "RUB",
      price: input.price,
      comments: `Сделка ${input.dealId}. Проезд на территорию. Госномер ${input.plate}`,
    },
  });
  const orderId = entityId(order);
  if (!orderId) throw new Error("Заказ Bitrix не создан");

  // Use Bitrix's catalog-aware basket method. The generic VibeCode endpoint
  // created MODULE=2 / TYPE=NULL rows. When the payment was completed Bitrix
  // added a second, valid MODULE=catalog / TYPE=2 row for the same product.
  // addCatalogProduct lets the catalog provider populate the service type,
  // product name and VAT from the product card and prevents that duplication.
  await bitrixRestRequest("sale.basketitem.addCatalogProduct", {
    fields: {
      orderId,
      productId: input.productId,
      price: input.price,
      quantity: 1,
      currency: "RUB",
      xmlId: `parking_deal_${input.dealId}_product_${input.productId}`,
    },
  });

  await verifyParkingOrderBasket(orderId, input.productId, input.price);

  const payment = await vibeRequest("/v1/payments", {
    method: "POST",
    body: {
      orderId,
      paySystemId: bitrixConfig.paySystemId,
      sum: input.price,
      currency: "RUB",
      paid: false,
      comments: `Оплата проезда. Сделка ${input.dealId}`,
    },
  });
  const paymentId = entityId(payment);
  if (!paymentId) throw new Error("Платёж Bitrix не создан");

  // Creating a payment must not mutate the basket. Abort before returning a
  // payment link if an integration or a Bitrix automation added another row.
  await verifyParkingOrderBasket(orderId, input.productId, input.price);

  return {
    orderId,
    paymentId,
    expiresAt: Date.now() + bitrixConfig.paymentTtlSeconds * 1000,
  };
}

async function verifyParkingOrderBasket(
  orderId: number,
  productId: number,
  expectedTotal: number,
): Promise<void> {
  const [basketResult, orderResult] = await Promise.all([
    bitrixRestRequest<{ basketItems?: SaleBasketRow[] }>("sale.basketitem.list", {
      filter: { "=orderId": orderId },
      select: [
        "id",
        "productId",
        "module",
        "type",
        "price",
        "quantity",
        "currency",
      ],
    }),
    bitrixRestRequest<{ order?: SaleOrderRow }>("sale.order.get", { id: orderId }),
  ]);
  const rows = Array.isArray(basketResult?.basketItems)
    ? basketResult.basketItems
    : [];
  const row = rows[0];
  const basketTotal = rows.reduce(
    (total, item) => total + Number(item.price ?? 0) * Number(item.quantity ?? 0),
    0,
  );
  const orderTotal = Number(orderResult?.order?.price ?? 0);
  const isService = Number(row?.type ?? 0) === 2;

  if (
    rows.length !== 1 ||
    Number(row?.productId ?? 0) !== productId ||
    String(row?.module ?? "").toLowerCase() !== "catalog" ||
    !isService ||
    Number(row?.price ?? 0) !== expectedTotal ||
    Number(row?.quantity ?? 0) !== 1 ||
    String(row?.currency ?? "").toUpperCase() !== "RUB" ||
    basketTotal !== expectedTotal ||
    orderTotal !== expectedTotal
  ) {
    throw new Error("Bitrix создал некорректную корзину; платёж отменён до выдачи ссылки");
  }
}

export async function saveParkingPayment(
  dealId: number,
  paymentId: number,
  expiresAt: number,
): Promise<void> {
  await bitrixRestRequest("crm.deal.update", {
    id: dealId,
    fields: {
      UF_CRM_PARKING_PAYMENT_ID: String(paymentId),
      UF_CRM_PARKING_PAYMENT_EXPIRES_AT: new Date(expiresAt).toISOString(),
      UF_CRM_PARKING_PAYMENT_EXPIRED: 0,
    },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
}

export async function activateParkingPayment(
  dealId: number,
  paymentId: number,
  paymentUrl: string,
): Promise<void> {
  const stages = await resolveStages();
  await bitrixRestRequest("crm.deal.update", {
    id: dealId,
    fields: {
      STAGE_ID: stages.awaiting,
      UF_CRM_PARKING_PAYMENT_ID: String(paymentId),
      UF_CRM_PARKING_PAYMENT_URL: paymentUrl,
      UF_CRM_PARKING_PAYMENT_EXPIRED: 0,
      UF_CRM_PARKING_NOTIFICATIONS_SENT: 1,
    },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
}

function paymentRecord(payment: unknown): Record<string, unknown> {
  if (!payment || typeof payment !== "object") return {};
  const record = payment as Record<string, unknown>;
  const data = record.data && typeof record.data === "object"
    ? (record.data as Record<string, unknown>)
    : record;
  return data.payment && typeof data.payment === "object"
    ? (data.payment as Record<string, unknown>)
    : data;
}

function paymentIsPaid(payment: unknown): boolean {
  const record = paymentRecord(payment);
  const paid = record.paid ?? record.PAID ?? record.payed ?? record.PAYED;
  return paid === true || paid === "Y" || paid === 1 || paid === "1";
}

export async function parkingPaymentState(
  paymentId: number,
): Promise<{ paid: boolean; orderId: number }> {
  const payment = await vibeRequest(`/v1/payments/${paymentId}`, { cache: "no-store" });
  const record = paymentRecord(payment);
  return {
    paid: paymentIsPaid(payment),
    orderId: Number(record.orderId ?? record.ORDER_ID ?? 0),
  };
}

export async function parkingOrderIsPaid(orderId: number): Promise<boolean> {
  const result = await bitrixRestRequest<{
    order?: { payed?: unknown; PAYED?: unknown };
  }>("sale.order.get", { id: orderId });
  const paid = result?.order?.payed ?? result?.order?.PAYED;
  return paid === true || paid === "Y" || paid === 1 || paid === "1";
}

export async function finalizeParkingDeal(dealId: number): Promise<void> {
  const stages = await resolveStages();
  await bitrixRestRequest("crm.deal.update", {
    id: dealId,
    fields: {
      UF_CRM_PARKING_PAYMENT_CONFIRMED: 1,
      UF_CRM_PARKING_PAID_AT: new Date().toISOString(),
    },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
  await bitrixRestRequest("crm.deal.update", {
    id: dealId,
    fields: { STAGE_ID: stages.paid },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
}

export async function expireParkingDeal(dealId: number): Promise<void> {
  await bitrixRestRequest("crm.deal.update", {
    id: dealId,
    fields: {
      UF_CRM_PARKING_PAYMENT_URL: "",
      UF_CRM_PARKING_PAYMENT_EXPIRED: 1,
    },
    params: { REGISTER_SONET_EVENT: "Y" },
  });
}
