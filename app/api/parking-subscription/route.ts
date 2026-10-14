import { NextRequest, NextResponse } from "next/server";
import { cleanEmail, cleanName } from "@/app/lib/input";
import {
  activateParkingPayment,
  createParkingDeal,
  createParkingPayment,
  findReusableParkingPayment,
  parkingProductId,
  saveParkingPayment,
  setParkingDealProduct,
  setParkingOrderBuyerProperties,
} from "@/app/lib/parking-bitrix";
import {
  formatForeignPlateInput,
  isForeignPlateValid,
  isRussianPlateValid,
  normalizeRussianPlate,
} from "@/app/lib/parking-plate";
import {
  isParkingTariffId,
  PARKING_TARIFFS,
  ParkingTariffId,
} from "@/app/lib/parking-tariffs";
import {
  assertSafeParkingDealContact,
  upsertParkingContact,
} from "@/app/lib/payment-contact";
import { normalizeRussianPhone } from "@/app/lib/phone";
import { createParkingPaymentUrl } from "@/app/lib/parking-payment-url";
import { moscowIsoDate } from "@/app/lib/parking-dates";
import { promoApiRequest } from "@/app/lib/promo-api";
import { ParkingPaymentToken, signToken } from "@/app/lib/tokens";
import { VibeCodeError } from "@/app/lib/vibecode";

export const dynamic = "force-dynamic";

type OrderBody = {
  lastName?: string;
  firstName?: string;
  patronymic?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  plate?: string;
  startDate?: string;
  tariffId?: ParkingTariffId;
  promoCode?: string;
  foreignPlate?: boolean;
  personalDataConsent?: boolean;
  offerAccepted?: boolean;
  marketingConsent?: boolean;
};

type CheckedPromo = {
  price?: number;
  tariffId?: string;
  group?: string;
  productId?: number | string;
};

type PaymentTimings = Record<string, number>;

type BindOrderResult = {
  bound?: boolean;
  buyerPropertiesVerified?: boolean;
};

async function timed<T>(
  timings: PaymentTimings,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[label] = (timings[label] ?? 0) + (Date.now() - startedAt);
  }
}

function logPaymentTimings(
  timings: PaymentTimings,
  requestStartedAt: number,
  details: Record<string, unknown> = {},
) {
  console.info(
    "PARKING_PAYMENT_TIMINGS",
    JSON.stringify({ totalMs: Date.now() - requestStartedAt, ...timings, ...details }),
  );
}

async function bindParkingOrder(input: {
  dealId: number;
  orderId: number;
  paymentId: number;
  fullName: string;
  email: string;
  phone: string;
}): Promise<void> {
  const result = await promoApiRequest<BindOrderResult>("bind_vibecode_order", input);
  if (result?.bound !== true) {
    throw new Error("Bitrix не подтвердил связь заказа со сделкой");
  }
  if (result.buyerPropertiesVerified === undefined) {
    console.warn(
      "PARKING_ORDER_BINDING_LEGACY_RESPONSE",
      JSON.stringify({
        dealId: input.dealId,
        orderId: input.orderId,
        paymentId: input.paymentId,
      }),
    );
  }
  await setParkingOrderBuyerProperties(input.orderId, {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
  });
}

const TARIFF_GROUPS: Record<ParkingTariffId, string> = {
  standard: "ST15",
  "client-all": "CL12",
  "client-weekdays": "CL08",
  "parent-all": "PA08",
  "parent-weekdays": "PA06",
  "friendship-parent-all": "DR08",
  "friendship-parent-weekdays": "DR06",
  test: "TS10",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  const timings: PaymentTimings = {};
  let step = "request";
  try {
    const body = (await request.json()) as OrderBody;
    const legacyName = cleanName(body.fullName);
    const legacyParts = legacyName.split(" ").filter(Boolean);
    const lastName = cleanName(body.lastName ?? legacyParts[0]);
    const firstName = cleanName(body.firstName ?? legacyParts[1]);
    const patronymic = cleanName(body.patronymic ?? legacyParts.slice(2).join(" "));
    const fullName = [lastName, firstName, patronymic].filter(Boolean).join(" ");
    const email = cleanEmail(body.email);
    const phone = normalizeRussianPhone(body.phone);
    const foreignPlate = body.foreignPlate === true;
    const plate = foreignPlate
      ? formatForeignPlateInput(body.plate)
      : normalizeRussianPlate(body.plate);
    const startDate = String(body.startDate ?? "");
    const tariffId = isParkingTariffId(body.tariffId) ? body.tariffId : null;
    const promoCode = String(body.promoCode ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/gu, "");
    const personalDataConsent = body.personalDataConsent === true;
    const offerAccepted = body.offerAccepted === true;
    const marketingConsent = body.marketingConsent === true;

    if (
      lastName.length < 2 ||
      firstName.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
      !/^\+7\d{10}$/u.test(phone)
    ) {
      return json({ error: "Проверьте имя, фамилию, телефон и электронную почту." }, 400);
    }
    if (foreignPlate ? !isForeignPlateValid(plate) : !isRussianPlateValid(plate)) {
      return json(
        {
          error: foreignPlate
            ? "Введите иностранный номер без пробелов."
            : "Введите российский госномер в формате А000АА77 или А000АА777.",
        },
        400,
      );
    }
    if (!personalDataConsent || !offerAccepted) {
      return json({ error: "Подтвердите согласие на обработку персональных данных и принятие публичной оферты." }, 400);
    }
    if (!tariffId || startDate < moscowIsoDate(1) || startDate > moscowIsoDate(30)) {
      return json({ error: "Выберите корректный тариф и дату старта." }, 400);
    }

    const tariff = PARKING_TARIFFS[tariffId];
    const productName = `Парковочный абонемент · ${tariff.name} · ${tariff.price.toLocaleString("ru-RU")} ₽`;
    if (startDate < tariff.activeFrom) {
      return json(
        {
          error: `Этот тариф действует для даты старта не ранее ${tariff.activeFrom
            .split("-")
            .reverse()
            .join(".")}.`,
        },
        400,
      );
    }

    let promoGroup = TARIFF_GROUPS[tariffId];
    let productIdFromPromo = 0;
    if (promoCode) {
      step = "promo-check-and-reuse";
      const [reuseResult, checkResult] = await Promise.allSettled([
        timed(timings, "paymentReuseMs", () => findReusableParkingPayment({
          promoCode,
          plate,
          email,
          price: tariff.price,
        })),
        timed(timings, "promoCheckMs", () =>
          promoApiRequest<CheckedPromo>("check", { code: promoCode })
        ),
      ]);
      if (reuseResult.status === "rejected") throw reuseResult.reason;
      if (checkResult.status === "rejected") throw checkResult.reason;
      const checked = checkResult.value;
      if (Number(checked.price) !== tariff.price || String(checked.tariffId ?? "") !== tariffId) {
        return json({ error: "Промокод не соответствует выбранному тарифу." }, 409);
      }
      promoGroup = String(checked.group ?? promoGroup);
      productIdFromPromo = Number(checked.productId ?? 0);

      const reusable = reuseResult.value;
      if (reusable) {
        step = "reused-deal-contact";
        await timed(timings, "contactGuardMs", () =>
          assertSafeParkingDealContact(reusable.dealId, {
            firstName,
            lastName,
            patronymic,
            phone,
            email,
          })
        );
        const reusableProductId = Number.isInteger(productIdFromPromo) && productIdFromPromo > 0
          ? productIdFromPromo
          : await timed(timings, "productLookupMs", () => parkingProductId(promoGroup));
        const [paymentUrl, paymentToken] = await Promise.all([
          timed(timings, "paymentLinkMs", () => createParkingPaymentUrl({
            dealId: reusable.dealId,
            paymentId: reusable.paymentId,
            expiresAt: reusable.expiresAt,
          })),
          signToken({
            purpose: "parking-payment",
            dealId: reusable.dealId,
            orderId: reusable.orderId,
            paymentId: reusable.paymentId,
            promoCode,
            expiresAt: reusable.expiresAt,
            exp: reusable.expiresAt + 24 * 60 * 60 * 1000,
          } satisfies ParkingPaymentToken),
          timed(timings, "paymentBindMs", () =>
            bindParkingOrder({
              dealId: reusable.dealId,
              orderId: reusable.orderId,
              paymentId: reusable.paymentId,
              fullName,
              email,
              phone,
            })
          ),
          timed(timings, "dealProductMs", () =>
            setParkingDealProduct(
              reusable.dealId,
              reusableProductId,
              productName,
              tariff.price,
            )
          ),
          timed(timings, "promoReserveMs", () =>
            promoApiRequest("reserve_vibecode", {
              code: promoCode,
              tariffId,
              dealId: reusable.dealId,
              paymentId: reusable.paymentId,
            })
          ),
        ]);
        logPaymentTimings(timings, requestStartedAt, {
          reused: true,
          dealId: reusable.dealId,
          paymentId: reusable.paymentId,
        });
        return json(
          {
            created: true,
            reused: true,
            pending: !paymentUrl,
            dealId: reusable.dealId,
            paymentId: reusable.paymentId,
            ...(paymentUrl ? { paymentUrl } : {}),
            paymentToken,
            expiresAt: reusable.expiresAt,
            price: tariff.price,
          },
          paymentUrl ? 200 : 202,
        );
      }
    } else if (tariffId !== "standard") {
      return json({ error: "Для льготного тарифа нужен промокод." }, 400);
    }

    step = "product-and-contact";
    const [productId, contactId] = await Promise.all([
      Number.isInteger(productIdFromPromo) && productIdFromPromo > 0
        ? Promise.resolve(productIdFromPromo)
        : timed(timings, "productLookupMs", () => parkingProductId(promoGroup)),
      timed(timings, "contactMs", () => upsertParkingContact({
        firstName,
        lastName,
        patronymic,
        phone,
        email,
      })),
    ]);

    step = "deal";
    const dealId = await timed(timings, "dealMs", () => createParkingDeal({
      contactId,
      fullName,
      email,
      phone,
      plate,
      foreignPlate,
      startDate,
      tariffId,
      tariffName: tariff.name,
      rateId: tariff.rateId,
      days: tariff.days,
      limit: tariff.limit,
      accessHours: tariff.accessHours,
      eligibility: tariff.eligibility,
      durationDays: tariff.durationDays,
      price: tariff.price,
      promoCode,
      promoGroup,
      personalDataConsent,
      offerAccepted,
      marketingConsent,
    }));

    step = "deal-contact";
    await timed(timings, "contactGuardMs", () =>
      assertSafeParkingDealContact(dealId, {
        firstName,
        lastName,
        patronymic,
        phone,
        email,
      })
    );

    step = "deal-product";
    await timed(timings, "dealProductMs", () =>
      setParkingDealProduct(dealId, productId, productName, tariff.price)
    );

    step = "payment";
    const payment = await timed(timings, "paymentCreateMs", () => createParkingPayment({
      dealId,
      productId,
      productName,
      price: tariff.price,
      plate,
    }));

    step = "payment-finalize";
    const [paymentUrl, paymentToken] = await Promise.all([
      timed(timings, "paymentLinkMs", () => createParkingPaymentUrl({
        dealId,
        paymentId: payment.paymentId,
        expiresAt: payment.expiresAt,
      })),
      signToken({
        purpose: "parking-payment",
        dealId,
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        promoCode,
        expiresAt: payment.expiresAt,
        exp: payment.expiresAt + 24 * 60 * 60 * 1000,
      } satisfies ParkingPaymentToken),
      timed(timings, "paymentSaveMs", () =>
        saveParkingPayment(dealId, payment.paymentId, payment.expiresAt)
      ),
      timed(timings, "paymentBindMs", () =>
        bindParkingOrder({
          dealId,
          orderId: payment.orderId,
          paymentId: payment.paymentId,
          fullName,
          email,
          phone,
        })
      ),
    ]);
    if (promoCode) {
      await timed(timings, "promoReserveMs", () => promoApiRequest("reserve_vibecode", {
        code: promoCode,
        tariffId,
        dealId,
        paymentId: payment.paymentId,
      }));
    }
    if (paymentUrl) {
      void activateParkingPayment(dealId, payment.paymentId, paymentUrl).catch((error) => {
        console.error(
          "PARKING_PAYMENT_ACTIVATION_ERROR",
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    logPaymentTimings(timings, requestStartedAt, {
      reused: false,
      dealId,
      paymentId: payment.paymentId,
    });

    return json(
      {
        created: true,
        pending: !paymentUrl,
        dealId,
        paymentId: payment.paymentId,
        ...(paymentUrl ? { paymentUrl } : {}),
        paymentToken,
        expiresAt: payment.expiresAt,
        price: tariff.price,
      },
      paymentUrl ? 200 : 202,
    );
  } catch (error) {
    console.error(
      "PARKING_VIBECODE_FLOW_ERROR",
      JSON.stringify({
        step,
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        status: error instanceof VibeCodeError ? error.status : undefined,
        code: error instanceof VibeCodeError ? error.code : undefined,
        totalMs: Date.now() - requestStartedAt,
        timings,
      }),
    );
    const publicMessage =
      error instanceof Error &&
      [
        "Промокод не найден.",
        "Промокод уже использован.",
        "Промокод уже зарезервирован для оплаты.",
        "Промокод не соответствует выбранному тарифу.",
      ].includes(error.message)
        ? error.message
        : "Не удалось подготовить оплату. Попробуйте ещё раз.";
    return json({ error: publicMessage, reference: `parking-${step}` }, 502);
  }
}
