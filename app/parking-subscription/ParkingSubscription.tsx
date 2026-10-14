"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatForeignPlateInput, formatRussianPlateInput } from "@/app/lib/parking-plate";
import { formatRussianPhoneInput } from "@/app/lib/phone";
import { addIsoDays } from "@/app/lib/parking-dates";
import { isParkingTariffId, PARKING_TARIFFS, ParkingTariffId } from "@/app/lib/parking-tariffs";
import LegalNotice from "@/app/LegalNotice";
import styles from "./parking-subscription.module.css";

type PromoResponse = {
  valid?: boolean;
  price?: number;
  tariffId?: string;
  error?: string;
};

type OrderResponse = {
  created?: boolean;
  dealId?: number;
  paymentUrl?: string;
  paymentToken?: string;
  expiresAt?: number;
  pending?: boolean;
  price?: number;
  error?: string;
};

type CalendarWindow = {
  timeZone: "Europe/Moscow";
  moscowNow: string;
  minStartDate: string;
  maxStartDate: string;
};

const BASE_PRICE = 15000;
const PAYMENT_WINDOW_NAME = "parking-subscription-payment";
const PAYMENT_TTL_MS = 15 * 60 * 1000;
function navigatePaymentWindow(target: Window | null, url: string) {
  if (!target) return false;

  try {
    target.location.href = url;
    target.focus();
    return true;
  } catch {
    return false;
  }
}

const formatPrice = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

const formatCountdown = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const formatDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthGrid(value: string) {
  const [year, month] = value.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => index + 1),
  ];
}

function calendarDate(month: string, day: number) {
  return `${month}-${String(day).padStart(2, "0")}`;
}

export default function ParkingSubscription() {
  const [code, setCode] = useState("");
  const [promo, setPromo] = useState<{ price: number; tariffId: ParkingTariffId } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [dealId, setDealId] = useState<number | null>(null);
  const [paymentToken, setPaymentToken] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [paymentExpiresAt, setPaymentExpiresAt] = useState(0);
  const [paymentSecondsLeft, setPaymentSecondsLeft] = useState(0);
  const [paymentWaiting, setPaymentWaiting] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState(false);
  const [returnChecking, setReturnChecking] = useState(false);
  const [returnMessage, setReturnMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [foreignPlate, setForeignPlate] = useState(false);
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [calendarWindow, setCalendarWindow] = useState<CalendarWindow | null>(null);
  const [calendarError, setCalendarError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("");
  const calendarRef = useRef<HTMLDivElement>(null);
  const paymentTabRef = useRef<Window | null>(null);

  const minStartDate = calendarWindow?.minStartDate ?? "";
  const maxStartDate = calendarWindow?.maxStartDate ?? "";
  const calendarDays = useMemo(() => calendarMonth ? monthGrid(calendarMonth) : [], [calendarMonth]);
  const price = promo?.price ?? BASE_PRICE;
  const selectedTariff = PARKING_TARIFFS[promo?.tariffId ?? "standard"];
  const endDate = useMemo(
    () => startDate ? addIsoDays(startDate, selectedTariff.durationDays - 1) : "",
    [startDate, selectedTariff.durationDays],
  );
  const limitedTariff = selectedTariff.limitHours !== null;

  useEffect(() => {
    let cancelled = false;
    const loadCalendarWindow = async () => {
      try {
        const response = await fetch("/api/parking-subscription/calendar", {
          cache: "no-store",
        });
        const payload = (await response.json()) as Partial<CalendarWindow>;
        const validDate = /^\d{4}-\d{2}-\d{2}$/u;
        if (
          !response.ok ||
          payload.timeZone !== "Europe/Moscow" ||
          typeof payload.moscowNow !== "string" ||
          typeof payload.minStartDate !== "string" ||
          typeof payload.maxStartDate !== "string" ||
          !validDate.test(payload.minStartDate) ||
          !validDate.test(payload.maxStartDate) ||
          payload.minStartDate > payload.maxStartDate
        ) {
          throw new Error("Некорректный ответ сервера времени.");
        }
        if (cancelled) return;
        const nextWindow = payload as CalendarWindow;
        setCalendarWindow(nextWindow);
        setCalendarError("");
        setStartDate((current) =>
          current >= nextWindow.minStartDate && current <= nextWindow.maxStartDate
            ? current
            : nextWindow.minStartDate,
        );
        setCalendarMonth(nextWindow.minStartDate.slice(0, 7));
      } catch {
        if (!cancelled) {
          setCalendarError("Не удалось получить московскую дату. Обновите страницу.");
          setCalendarOpen(false);
        }
      }
    };
    void loadCalendarWindow();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "verify") return;
    const returnedDealId = Number(params.get("dealId") ?? 0);
    const returnedPaymentId = Number(params.get("paymentId") ?? 0);
    const returnedExpires = Number(params.get("exp") ?? 0);
    const returnedSignature = String(params.get("sig") ?? "").trim().toLowerCase();
    const validReturn = Number.isInteger(returnedDealId) && returnedDealId > 0
      && Number.isInteger(returnedPaymentId) && returnedPaymentId > 0
      && Number.isInteger(returnedExpires) && returnedExpires > 0
      && /^[a-f0-9]{64}$/u.test(returnedSignature);
    if (!validReturn) {
      window.history.replaceState({}, "", "/parking-subscription");
      setReturnMessage("Оплата не подтверждена. Вы можете повторить оплату.");
      return;
    }

    let cancelled = false;
    let timer = 0;
    setDealId(returnedDealId);
    setReturnChecking(true);
    const verifyReturn = async () => {
      let lastRequestFailed = false;
      try {
        for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
          if (attempt > 0) {
            await new Promise<void>((resolve) => {
              timer = window.setTimeout(resolve, 1500);
            });
          }
          if (cancelled) return;
          try {
            const response = await fetch("/api/parking-subscription/return-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dealId: returnedDealId,
                paymentId: returnedPaymentId,
                expires: returnedExpires,
                signature: returnedSignature,
              }),
              cache: "no-store",
            });
            const payload = (await response.json()) as { paid?: boolean; expired?: boolean };
            lastRequestFailed = !response.ok;
            if (cancelled) return;
            if (response.ok && payload.paid === true) {
              setPaymentMessage("Оплата подтверждена. Сделка переведена в стадию «Оплачено».");
              setPurchased(true);
              return;
            }
            if (response.ok && payload.expired === true) break;
          } catch {
            lastRequestFailed = true;
          }
        }
        if (!cancelled) {
          window.history.replaceState({}, "", "/parking-subscription");
          setReturnMessage(lastRequestFailed
            ? "Не удалось проверить оплату. Вернитесь к оформлению и попробуйте ещё раз."
            : "Оплата не подтверждена. Вернитесь к оформлению и попробуйте ещё раз.");
        }
      } finally {
        if (!cancelled) setReturnChecking(false);
      }
    };
    void verifyReturn();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!calendarOpen) return;

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !calendarRef.current?.contains(event.target)) {
        setCalendarOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (!paymentWaiting || paymentExpiresAt <= 0) {
      setPaymentSecondsLeft(0);
      return;
    }
    const update = () => {
      setPaymentSecondsLeft(Math.max(0, Math.ceil((paymentExpiresAt - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [paymentExpiresAt, paymentWaiting]);

  useEffect(() => {
    if (!paymentToken || !paymentWaiting) return;

    let cancelled = false;
    let checking = false;
    const checkPayment = async () => {
      if (cancelled || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/parking-subscription/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentToken }),
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          paid?: boolean;
          expired?: boolean;
          promoReleased?: boolean;
        };
        if (cancelled) return;
        if (response.ok && payload.expired) {
          if (paymentTabRef.current && !paymentTabRef.current.closed) {
            paymentTabRef.current.close();
          }
          paymentTabRef.current = null;
          setPaymentWaiting(false);
          setPaymentToken("");
          setPaymentUrl("");
          setPaymentExpiresAt(0);
          setPaymentError(true);
          setPaymentMessage("15 минут истекли. Ссылка на оплату больше не действует.");
          if (promo) {
            setPromo(null);
            setError(false);
            setMessage(payload.promoReleased
              ? "Промокод снова доступен. Примените его повторно для новой оплаты."
              : "Примените промокод повторно перед новой оплатой.");
          }
          return;
        }
        // Возвращаем покупателя на сайт сразу после подтверждения оплаты.
        // Формирование и отправка кассового чека не должны блокировать возврат.
        if (!response.ok || !payload.paid) return;

        if (paymentTabRef.current && !paymentTabRef.current.closed) {
          paymentTabRef.current.close();
        }
        paymentTabRef.current = null;
        window.focus();
        setPaymentWaiting(false);
        setPaymentExpiresAt(0);
        setPaymentError(false);
        setPaymentMessage("Оплата подтверждена. Сделка переведена в стадию «Оплачено».");
        setPurchased(true);
      } catch {
        // Следующая фоновая проверка повторит запрос.
      } finally {
        checking = false;
      }
    };

    void checkPayment();
    const timer = window.setInterval(checkPayment, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dealId, paymentToken, paymentWaiting, promo]);

  useEffect(() => {
    if (!paymentToken || !paymentWaiting || paymentUrl) return;

    let cancelled = false;
    let checking = false;
    let timer = 0;
    const linkDeadline = paymentExpiresAt || Date.now() + PAYMENT_TTL_MS;
    const checkPaymentLink = async () => {
      if (cancelled || checking) return;
      if (Date.now() >= linkDeadline) {
        cancelled = true;
        window.clearInterval(timer);
        return;
      }
      checking = true;
      try {
        const response = await fetch("/api/parking-subscription/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentToken }),
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ready?: boolean;
          paymentUrl?: string;
        };
        if (
          cancelled ||
          !response.ok ||
          !payload.ready ||
          !payload.paymentUrl
        ) {
          return;
        }

        setPaymentUrl(payload.paymentUrl);
        const paymentOpened = navigatePaymentWindow(paymentTabRef.current, payload.paymentUrl);
        setPaymentMessage(paymentOpened
          ? "Ссылка готова. Статус оплаты проверяется автоматически."
          : "Ссылка готова. Нажмите «Открыть оплату».");
      } catch {
        // Bitrix может закончить формирование ссылки при следующей проверке.
      } finally {
        checking = false;
      }
    };

    void checkPaymentLink();
    timer = window.setInterval(checkPaymentLink, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paymentExpiresAt, paymentToken, paymentUrl, paymentWaiting]);

  async function checkPromo() {
    if (!code.trim()) {
      setPromo(null);
      setError(true);
      setMessage("Введите промокод.");
      return;
    }

    setLoading(true);
    setError(false);
    setMessage("");

    try {
      const response = await fetch("/api/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", code }),
      });
      const payload = (await response.json()) as PromoResponse;
      if (
        !response.ok ||
        !payload.valid ||
        typeof payload.price !== "number" ||
        !isParkingTariffId(payload.tariffId)
      ) {
        throw new Error(payload.error ?? "Не удалось проверить промокод.");
      }
      const tariff = PARKING_TARIFFS[payload.tariffId];
      if (startDate && maxStartDate && startDate < tariff.activeFrom && tariff.activeFrom <= maxStartDate) {
        setStartDate(tariff.activeFrom);
        setCalendarMonth(tariff.activeFrom.slice(0, 7));
      }
      setPromo({ price: payload.price, tariffId: payload.tariffId });
      setMessage(`Промокод принят. Стоимость снижена до ${formatPrice(payload.price)}.`);
    } catch (requestError) {
      setPromo(null);
      setError(true);
      setMessage(requestError instanceof Error ? requestError.message : "Не удалось проверить промокод.");
    } finally {
      setLoading(false);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personalDataConsent || !offerAccepted) {
      setPaymentError(true);
      setPaymentMessage("Подтвердите согласие на обработку персональных данных и принятие публичной оферты.");
      return;
    }
    const preparedTab = window.open("/payment-preparing", PAYMENT_WINDOW_NAME);
    paymentTabRef.current = preparedTab;
    setLoading(true);
    setError(false);
    setPaymentError(false);
    setPaymentMessage("Создаём заявку и готовим ссылку на оплату…");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/parking-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastName: form.get("lastName"),
          firstName: form.get("firstName"),
          patronymic: form.get("patronymic"),
          email: form.get("email"),
          phone,
          plate,
          startDate: form.get("startDate"),
          tariffId: promo?.tariffId ?? "standard",
          promoCode: promo ? code : "",
          foreignPlate,
          personalDataConsent,
          offerAccepted,
          marketingConsent,
        }),
      });
      const payload = (await response.json()) as OrderResponse;
      if (!response.ok || !payload.created) throw new Error(payload.error ?? "Не удалось оформить абонемент.");
      if (!payload.paymentToken) throw new Error("Не удалось получить данные платежа.");
      setDealId(payload.dealId ?? null);
      setPaymentToken(payload.paymentToken);
      setPaymentExpiresAt(payload.expiresAt ?? Date.now() + PAYMENT_TTL_MS);
      setPaymentWaiting(true);
      setPaymentUrl(payload.paymentUrl ?? "");
      if (payload.paymentUrl) {
        const paymentOpened = navigatePaymentWindow(preparedTab, payload.paymentUrl);
        setPaymentMessage(paymentOpened
          ? "Ссылка готова. Статус оплаты проверяется автоматически."
          : "Ссылка готова. Нажмите «Открыть оплату».");
        return;
      }
      setPaymentMessage("Bitrix формирует ссылку на оплату…");
    } catch (requestError) {
      if (preparedTab && !preparedTab.closed) preparedTab.close();
      if (paymentTabRef.current === preparedTab) paymentTabRef.current = null;
      setPaymentWaiting(false);
      setPaymentError(true);
      setPaymentMessage(requestError instanceof Error ? requestError.message : "Не удалось оформить абонемент.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/brand/luzhniki-logo.png" alt="Лужники" width="330" height="58" />
        <span>Проезд на территорию спортивного комплекса</span>
      </header>

      <main className={styles.main}>
        {returnChecking ? (
          <section className={styles.successCard} aria-live="polite">
            <div className={styles.checkingIcon} aria-hidden="true">…</div>
            <p className={styles.eyebrow}>Проверяем оплату</p>
            <h1>Проверяем результат</h1>
            <p>Это займёт несколько секунд.</p>
          </section>
        ) : purchased ? (
          <section className={styles.successCard}>
            <div className={styles.successIcon} aria-hidden="true">✓</div>
            <p className={styles.eyebrow}>Оплата подтверждена</p>
            <h1>Абонемент оплачен</h1>
            {dealId && <p className={styles.dealNumber}>Номер заявки: {dealId}</p>}
          </section>
        ) : (
          <section className={styles.purchaseCard}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>Абонемент на 30 дней</p>
              <h1>Абонемент на проезд</h1>
              <p className={styles.basePrice}>
                <span>Базовая стоимость</span>
                <strong>{formatPrice(BASE_PRICE)}</strong>
              </p>
            </div>

            {returnMessage && (
              <div className={styles.returnNotice} role="alert">{returnMessage}</div>
            )}

            <section className={styles.instructions} aria-labelledby="buyer-instructions">
              <h2 id="buyer-instructions">Как оформить абонемент</h2>
              <ol>
                <li><span>1</span><p>Заполните данные</p></li>
                <li><span>2</span><p>Проведите оплату</p></li>
                <li>
                  <span>3</span>
                  <p>Абонемент будет активирован со следующего дня после оплаты либо с выбранной вами более поздней даты старта.</p>
                </li>
              </ol>
            </section>

            <section className={styles.globalRule} aria-label="Основные правила использования абонемента">
              <strong>Основные правила</strong>
              <ul>
                <li>Убедитесь, что номер автомобиля чистый и легко читаемый.</li>
                <li>Предъявлять абонемент не нужно: данные о вашем автомобиле уже в системе. При въезде получите парковочный билет и сохраните его до выезда.</li>
                <li>Один абонемент оформляется на одно транспортное средство.</li>
              </ul>
            </section>

            <section className={styles.globalRule} aria-label="Важные ограничения абонемента">
              <strong>Важно</strong>
              <p>Находиться на территории Спорткомплекса с 01:00 до 06:00 запрещено. За нарушение — 25 000 ₽ плюс стоимость фактически оказанной услуги.</p>
              <p>В дни мероприятий и временных ограничений абонемент не действует, срок его действия не продлевается.</p>
            </section>

            <form className={styles.orderForm} onSubmit={submitOrder}>
              <div className={styles.ownerGrid}>
                <div className={styles.ownerColumn}>
                  <label>Фамилия<input name="lastName" type="text" autoComplete="family-name" minLength={2} maxLength={80} required /></label>
                  <label>Имя<input name="firstName" type="text" autoComplete="given-name" minLength={2} maxLength={80} required /></label>
                  <label>
                    <span className={styles.labelLine}>Отчество <small>Необязательно</small></span>
                    <input name="patronymic" type="text" autoComplete="additional-name" maxLength={80} />
                  </label>
                </div>

                <div className={styles.ownerColumn}>
                  <label>Номер телефона<input name="phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(formatRussianPhoneInput(event.target.value))} placeholder="+7 999 000-00-00" required /></label>
                  <label>Электронная почта<input name="email" type="email" autoComplete="email" maxLength={160} required /></label>
                  <label className={styles.plateField}>
                    Номер автомобиля
                    <input
                      name="plate"
                      type="text"
                      autoComplete="off"
                      value={plate}
                      onChange={(event) => {
                        event.currentTarget.setCustomValidity("");
                        setPlate(foreignPlate
                          ? formatForeignPlateInput(event.currentTarget.value)
                          : formatRussianPlateInput(event.currentTarget.value));
                      }}
                      onInvalid={(event) => event.currentTarget.setCustomValidity(foreignPlate
                        ? "Введите номер без пробелов."
                        : "Введите российский госномер в формате А000АА77 или А000АА777.")}
                      placeholder={foreignPlate ? "ABC1234" : "А000АА77"}
                      pattern={foreignPlate ? "\\S+" : "[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}"}
                      minLength={foreignPlate ? 1 : 8}
                      maxLength={foreignPlate ? 32 : 9}
                      aria-describedby="plate-format-hint"
                      required
                    />
                    <small id="plate-format-hint" className={styles.plateHint}>
                      {foreignPlate ? "Без пробелов. Все символы переводятся в верхний регистр." : "Формат: А000АА77 или А000АА777"}
                    </small>
                    <span className={styles.foreignPlateOption}>
                      <input
                        type="checkbox"
                        checked={foreignPlate}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setForeignPlate(enabled);
                          setPlate(enabled ? formatForeignPlateInput(plate) : formatRussianPlateInput(plate));
                        }}
                      />
                      Иностранный номер
                    </span>
                  </label>
                </div>
              </div>

              <div className={styles.dateField}>
                  <span className={styles.dateLabel}>Выберите дату старта работы абонемента</span>
                  <input name="startDate" type="hidden" value={startDate} />
                  <div className={styles.datePicker} ref={calendarRef}>
                    <button
                      className={styles.dateTrigger}
                      type="button"
                      disabled={!calendarWindow}
                      aria-label={startDate
                        ? `Выберите дату старта работы абонемента: ${formatDate(startDate)}`
                        : "Получаем московскую дату"}
                      aria-expanded={calendarOpen}
                      aria-haspopup="dialog"
                      onClick={() => {
                        if (!startDate) return;
                        setCalendarMonth(startDate.slice(0, 7));
                        setCalendarOpen((open) => !open);
                      }}
                    >
                      <span>{startDate ? formatDate(startDate) : "Получаем московскую дату…"}</span>
                    </button>

                    {calendarOpen && (
                      <div className={styles.calendarPanel} role="dialog" aria-label="Выбор даты старта абонемента">
                        <div className={styles.calendarHeader}>
                          <button
                            type="button"
                            aria-label="Предыдущий месяц"
                            disabled={calendarMonth <= minStartDate.slice(0, 7)}
                            onClick={() => setCalendarMonth((month) => shiftMonth(month, -1))}
                          >
                            ←
                          </button>
                          <strong>{monthLabel(calendarMonth)}</strong>
                          <button
                            type="button"
                            aria-label="Следующий месяц"
                            disabled={calendarMonth >= maxStartDate.slice(0, 7)}
                            onClick={() => setCalendarMonth((month) => shiftMonth(month, 1))}
                          >
                            →
                          </button>
                        </div>
                        <div className={styles.calendarWeekdays} aria-hidden="true">
                          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
                        </div>
                        <div className={styles.calendarGrid}>
                          {calendarDays.map((day, index) => {
                            if (day === null) return <span key={`empty-${index}`} aria-hidden="true" />;
                            const value = calendarDate(calendarMonth, day);
                            const available = value >= minStartDate && value <= maxStartDate;
                            const selected = value === startDate;
                            return (
                              <button
                                key={value}
                                type="button"
                                className={`${styles.calendarDay} ${available ? styles.calendarDayAvailable : ""} ${selected ? styles.calendarDaySelected : ""}`}
                                disabled={!available}
                                aria-label={formatDate(value)}
                                aria-pressed={selected}
                                onClick={() => {
                                  setStartDate(value);
                                  setCalendarOpen(false);
                                }}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                        <div className={styles.calendarLegend}><i aria-hidden="true" /> Доступно для выбора</div>
                      </div>
                    )}
                  </div>
                  {calendarError ? (
                    <p className={styles.dateRange} role="alert">{calendarError}</p>
                  ) : startDate && endDate ? (
                    <p className={styles.dateRange}>
                      Въезд разрешён с <strong>{formatDate(startDate)}</strong> по <strong>{formatDate(endDate)}</strong> включительно.
                    </p>
                  ) : null}
                </div>

              <div className={styles.promoBlock}>
                <label htmlFor="promo-code">Промокод</label>
                <div className={styles.promoEntry}>
                  <input
                    id="promo-code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      setPromo(null);
                      setMessage("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void checkPromo();
                      }
                    }}
                    placeholder="Введите промокод"
                    autoComplete="off"
                    maxLength={32}
                  />
                  <button type="button" onClick={() => void checkPromo()} disabled={loading || paymentWaiting || !code.trim()}>
                    {loading ? "Проверяем…" : "Применить"}
                  </button>
                </div>
                <p className={error ? styles.error : styles.formMessage} aria-live="polite">
                  {message || "Если у вас есть промокод, примените его перед оплатой."}
                </p>
                <p className={styles.promoHelp}>Если вы потеряли промокод, обратитесь на ресепшен объекта.</p>
              </div>

              <section className={styles.tariffConditions} aria-live="polite">
                <h2>{selectedTariff.name}</h2>
                <dl className={styles.tariffConditionsGrid}>
                  <div><dt>Дни</dt><dd>{selectedTariff.days}</dd></div>
                  <div><dt>Время посещения</dt><dd>{selectedTariff.accessHours}</dd></div>
                  <div><dt>Длительность визита</dt><dd>{selectedTariff.limit}</dd></div>
                  <div><dt>Срок действия</dt><dd>{selectedTariff.durationDays} календарных дней</dd></div>
                  <div className={styles.tariffEligibility}><dt>Кому доступен</dt><dd>{selectedTariff.eligibility}</dd></div>
                </dl>
                {limitedTariff && (
                  <div className={styles.tariffRules}>
                    <p><strong>Сверх {selectedTariff.limitHours} часов</strong> нахождение на территории оплачивается по стандартному тарифу.</p>
                  </div>
                )}
              </section>

              <div className={styles.paymentBlock}>
                <p className={styles.eyebrow}>Оплата</p>
                {paymentMessage && (
                  <div className={`${styles.paymentStatus} ${paymentError ? styles.paymentStatusError : styles.paymentStatusWaiting}`} role={paymentError ? "alert" : "status"}>
                    {!paymentError && <i className={styles.paymentPulse} aria-hidden="true" />}
                    <span className={styles.paymentStatusCopy}>
                      <span>{paymentMessage}</span>
                      {paymentWaiting && paymentSecondsLeft > 0 && (
                        <strong>Оплатить в течение {formatCountdown(paymentSecondsLeft)}</strong>
                      )}
                    </span>
                    {paymentUrl && (
                      <a href={paymentUrl} target={PAYMENT_WINDOW_NAME}>Открыть оплату</a>
                    )}
                  </div>
                )}
                <div className={styles.agreements} aria-label="Согласия">
                  <label className={styles.agreement}>
                    <input
                      type="checkbox"
                      checked={personalDataConsent}
                      onChange={(event) => setPersonalDataConsent(event.target.checked)}
                      required
                    />
                    <span>
                      Отмечая этот пункт, я даю согласие на обработку моих персональных данных в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» на условиях и для целей, определённых в{" "}
                      <a
                        href="https://www.luzhniki.ru/documents/494/%D0%A1%D0%BE%D0%B3%D0%BB%D0%B0%D1%81%D0%B8%D0%B5_%D0%BD%D0%B0_%D0%BE%D0%B1%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D1%83_%D0%B1%D0%B5%D0%B7_%D0%BF%D1%80%D0%B8%D0%B2%D0%BE%D0%BB%D0%B5%D1%87%D0%B5%D0%BD%D0%B8%D1%8F_%D1%82%D1%80%D0%B5%D1%82%D1%8C%D0%B8%D1%85_%D0%BB%D0%B8%D1%86.pdf"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Согласии на обработку персональных данных
                      </a>{" "}
                      <b aria-hidden="true">*</b>
                    </span>
                  </label>
                  <label className={styles.agreement}>
                    <input
                      type="checkbox"
                      checked={offerAccepted}
                      onChange={(event) => setOfferAccepted(event.target.checked)}
                      required
                    />
                    <span>
                      Отмечая этот пункт, я принимаю условия{" "}
                      <Link href="/offer" target="_blank">
                        публичной оферты
                      </Link>
                      . <b aria-hidden="true">*</b>
                    </span>
                  </label>
                  <label className={styles.agreement}>
                    <input
                      type="checkbox"
                      name="marketingConsent"
                      checked={marketingConsent}
                      onChange={(event) => setMarketingConsent(event.target.checked)}
                    />
                    <span>
                      Отмечая этот пункт, я даю согласие на получение рекламных и информационных сообщений об акциях, специальных предложениях, мероприятиях, товарах и услугах комплекса по электронной почте, SMS, push-уведомлениям и другим каналам связи.
                    </span>
                  </label>
                </div>
                <button
                  className={styles.buyButton}
                  type="submit"
                  disabled={loading || paymentWaiting || !calendarWindow || !startDate || !personalDataConsent || !offerAccepted}
                >
                  {loading ? "Готовим оплату…" : paymentWaiting ? "Ожидаем оплату…" : `Перейти к оплате · ${formatPrice(price)}`}
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
      <LegalNotice />
    </div>
  );
}
