import { getPublicPaymentUrl } from "./bitrix";

/**
 * Request Bitrix's public Sales Center page. This is the branded
 * pay.luzhniki.ru order page where the visitor accepts the payment consent
 * and only then proceeds to the bank.
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

  return getPublicPaymentUrl(input.paymentId);
}
