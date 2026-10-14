import vinext from "vinext";
import { defineConfig } from "vite";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: Object.fromEntries(
    [
      "VIBECODE_API_KEY",
      "B24_WEBHOOK_URL",
      "B24_PORTAL_HOST",
      "B24_PAYMENT_PUBLIC_HOST",
      "B24_PARKING_CATEGORY_ID",
      "B24_PARKING_DRAFT_STAGE_ID",
      "B24_PARKING_AWAITING_STAGE_ID",
      "B24_PARKING_PAID_STAGE_ID",
      "B24_PERSON_TYPE_ID",
      "B24_PAY_SYSTEM_ID",
      "B24_PARKING_RESPONSIBLE_ID",
      "PARKING_PAYMENT_TTL_SECONDS",
      "BITRIX_PROMO_API_URL",
      "BITRIX_PROMO_API_TOKEN",
      "BITRIX_PAYMENT_SIGNATURE_TOKEN",
      "APP_SESSION_SECRET",
    ]
      .map((name) => [name, process.env[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  ),
};

export default defineConfig(async () => {
  // The Windows localhost preview does not need the Cloudflare worker layer.
  // Running Vinext directly keeps CSS, images and other public assets on the
  // same local origin. Production builds continue to use Cloudflare.
  if (process.env.LOCAL_NODE_PREVIEW === "true") {
    return { plugins: [vinext()] };
  }

  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
