import assert from "node:assert/strict";
import test from "node:test";
import { parkingReturnPayload, verifyParkingReturn } from "../app/lib/parking-return.ts";

const encoder = new TextEncoder();

async function signedReturn(overrides = {}) {
  const value = {
    dealId: 859777,
    paymentId: 2996,
    expires: 1791968400,
    ...overrides,
  };
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(parkingReturnPayload(value)),
  );
  return {
    ...value,
    signature: Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

test.before(() => {
  process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN = "return-test-secret";
});

test("accepts the signed payment return", async () => {
  assert.equal(await verifyParkingReturn(await signedReturn(), process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN), true);
});

test("rejects a payment return for another deal", async () => {
  const original = await signedReturn();
  assert.equal(await verifyParkingReturn(
    { ...original, dealId: original.dealId + 1 },
    process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN,
  ), false);
});

test("rejects malformed signatures", async () => {
  assert.equal(await verifyParkingReturn(
    { ...(await signedReturn()), signature: "success" },
    process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN,
  ), false);
});
