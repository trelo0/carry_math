/** Личный кабинет мерчанта bePaid (чек, возврат — вручную в UI bePaid). */
export const BEPAY_MERCHANT_PORTAL_URL = 'https://merchant.bepaid.by/';

/** Публичного стабильного deep-link на транзакцию в доках нет — открываем ЛК, UID в подсказке. */
export function bePaidMerchantPortalUrl(): string {
  return BEPAY_MERCHANT_PORTAL_URL;
}
