const required = [
  "VIBECODE_API_KEY",
  "B24_WEBHOOK_URL",
  "BITRIX_PROMO_API_URL",
  "BITRIX_PROMO_API_TOKEN",
  "BITRIX_PAYMENT_SIGNATURE_TOKEN",
  "APP_SESSION_SECRET",
];

for (const name of required) {
  const value = String(process.env[name] ?? "").trim();
  if (!value || value.includes("CHANGE_ME")) {
    console.error(`Не заполнена обязательная настройка ${name}.`);
    process.exit(1);
  }
}

const apiUrl = new URL(process.env.BITRIX_PROMO_API_URL);
if (apiUrl.protocol !== "https:") {
  console.error("BITRIX_PROMO_API_URL должен использовать HTTPS.");
  process.exit(1);
}

const webhookUrl = new URL(process.env.B24_WEBHOOK_URL);
if (
  webhookUrl.protocol !== "https:" ||
  !/^\/rest\/\d+\/[^/]+\/?$/u.test(webhookUrl.pathname)
) {
  console.error("B24_WEBHOOK_URL должен быть базовым URL входящего REST-вебхука Bitrix24.");
  process.exit(1);
}

if (process.env.VIBECODE_API_KEY.trim().length < 16) {
  console.error("VIBECODE_API_KEY слишком короткий.");
  process.exit(1);
}

if (process.env.BITRIX_PROMO_API_TOKEN.trim().length < 16) {
  console.error("BITRIX_PROMO_API_TOKEN слишком короткий.");
  process.exit(1);
}

if (process.env.BITRIX_PAYMENT_SIGNATURE_TOKEN.trim().length < 16) {
  console.error("BITRIX_PAYMENT_SIGNATURE_TOKEN слишком короткий.");
  process.exit(1);
}

if (process.env.APP_SESSION_SECRET.trim().length < 32) {
  console.error("APP_SESSION_SECRET должен содержать не менее 32 символов.");
  process.exit(1);
}

console.log("Настройки сервера проверены.");
