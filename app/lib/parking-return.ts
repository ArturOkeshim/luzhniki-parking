export type ParkingReturn = {
  dealId: number;
  paymentId: number;
  expires: number;
  signature: string;
};

const encoder = new TextEncoder();

function signatureBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[a-f0-9]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function parkingReturnPayload(input: Omit<ParkingReturn, "signature">): string {
  return `return|${input.paymentId}|${input.dealId}|${input.expires}`;
}

export async function verifyParkingReturn(input: ParkingReturn, secret: string): Promise<boolean> {
  if (
    !Number.isInteger(input.dealId) ||
    input.dealId <= 0 ||
    !Number.isInteger(input.paymentId) ||
    input.paymentId <= 0 ||
    !Number.isInteger(input.expires) ||
    input.expires <= 0
  ) {
    return false;
  }

  const suppliedSignature = signatureBytes(input.signature.toLowerCase());
  if (!suppliedSignature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    suppliedSignature,
    encoder.encode(parkingReturnPayload(input)),
  );
}
