import { bitrixConfig, requiredRuntimeValue } from "./config";

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the signed Bitrix payment gateway URL locally.
 *
 * This does not wait for salescenter.payment.getPublicUrl. The Bitrix-side
 * pay.php validates the signature, opens the configured payment system and
 * sets the return URL back to the parking site.
 */
export async function createParkingPaymentUrl(input: {
  dealId: number;
  paymentId: number;
  expiresAt: number;
}): Promise<string> {
  if (
    !Number.isInteger(input.dealId) ||
    input.dealId <= 0 ||
    !Number.isInteger(input.paymentId) ||
    input.paymentId <= 0 ||
    !Number.isFinite(input.expiresAt)
  ) {
    throw new Error("Некорректные данные платежа");
  }

  const promoApiUrl = new URL(requiredRuntimeValue("BITRIX_PROMO_API_URL"));
  if (
    promoApiUrl.protocol !== "https:" ||
    promoApiUrl.hostname.toLowerCase() !== bitrixConfig.portalHost
  ) {
    throw new Error("Некорректная настройка BITRIX_PROMO_API_URL");
  }

  // The gateway validates links with its primary signing token. The promo API
  // can also accept secondary/test tokens, so it must never be used as an
  // implicit fallback here: such a link looks valid locally but pay.php
  // correctly rejects it.
  const token = requiredRuntimeValue("BITRIX_PAYMENT_SIGNATURE_TOKEN");
  const expires = Math.floor(input.expiresAt / 1000);
  const payload = `payment|${input.paymentId}|${input.dealId}|${expires}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const url = new URL("pay.php", promoApiUrl);
  url.searchParams.set("id", String(input.paymentId));
  url.searchParams.set("deal", String(input.dealId));
  url.searchParams.set("exp", String(expires));
  url.searchParams.set("sig", signature);
  return url.toString();
}
