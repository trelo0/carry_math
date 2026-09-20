import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  ACCESS_PRODUCT_LABELS,
  type AccessProduct,
  isAccessProduct,
} from './accesses';
import { getBaseUrlString } from '@/lib/siteUrl';
import {
  createPurchaseRequest,
  findPendingPurchaseRequest,
  isPurchaseRequestTableError,
  type PurchaseRequestRow,
} from './purchase-requests';
import { notifyAdminsOfNewPurchaseRequest } from './admin/purchases';
import { getCabinetPricing, type CabinetPricing } from '@/lib/studio/cabinetSettings';
import { resolvePurchaseOffer } from './purchase-fulfillment';

type AdminMessage = { chatId: number; messageId: number };

type InlineKeyboard = { inline_keyboard: Array<Array<Record<string, string>>> };

export type PurchaseStartOptions = {
  product?: AccessProduct;
  packageIndex?: number;
  teacherIndex?: number;
};

const PRODUCT_CODES: Record<AccessProduct, string> = {
  course: 'c',
  individual: 'i',
  group: 'g',
};

const CODE_TO_PRODUCT: Record<string, AccessProduct> = {
  c: 'course',
  i: 'individual',
  g: 'group',
};

export function parsePayStartPayload(source: string): PurchaseStartOptions {
  if (!source.startsWith('pay_')) return {};
  const parts = source.slice('pay_'.length).split('_');
  const productRaw = parts[0];
  if (!isAccessProduct(productRaw)) return {};
  const options: PurchaseStartOptions = { product: productRaw };
  if (parts[1] !== undefined && parts[1] !== '') {
    const pkg = Number(parts[1]);
    if (Number.isFinite(pkg)) options.packageIndex = pkg;
  }
  if (parts[2] !== undefined && parts[2] !== '') {
    const ti = Number(parts[2]);
    if (Number.isFinite(ti)) options.teacherIndex = ti;
  }
  return options;
}

export function buildPayStartPayload(
  product: AccessProduct,
  packageIndex?: number,
  teacherIndex?: number,
): string {
  let payload = `pay_${product}`;
  if (packageIndex != null) payload += `_${packageIndex}`;
  if (teacherIndex != null) payload += `_${teacherIndex}`;
  return payload;
}

export function isStudentPurchaseAction(data: string): boolean {
  return data.startsWith('sp:');
}

async function isTelegramLinked(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data } = await admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle();
  return !!data?.phone;
}

function productCode(product: AccessProduct): string {
  return PRODUCT_CODES[product];
}

function productFromCode(code: string): AccessProduct | null {
  return CODE_TO_PRODUCT[code] ?? null;
}

function formatMoney(amount: number): string {
  return `${amount} BYN`;
}

async function sendPurchaseMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

async function editPurchaseMessage(message: AdminMessage, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await telegramSend('editMessageText', {
    chat_id: message.chatId,
    message_id: message.messageId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

function productMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '🎓 Курс', callback_data: 'sp:p:c' }],
      [{ text: '📚 Индивидуальные занятия', callback_data: 'sp:p:i' }],
      [{ text: '👥 Групповые занятия', callback_data: 'sp:p:g' }],
    ],
  };
}

async function resolveOffer(
  pricing: CabinetPricing,
  product: AccessProduct,
  packageIndex: number,
  teacherId?: string,
) {
  return resolvePurchaseOffer(pricing, {
    product,
    packageIndex,
    teacherId,
  });
}

async function renderProductMenu(chatId: number, message?: AdminMessage): Promise<void> {
  const text =
    '💳 Покупка\n\n' +
    'Выберите, что хотите приобрести. После подтверждения заявки администратор свяжется с вами для оплаты.';
  if (message) await editPurchaseMessage(message, text, productMenuKeyboard());
  else await sendPurchaseMessage(chatId, text, productMenuKeyboard());
}

async function renderPackageStep(
  pricing: CabinetPricing,
  product: AccessProduct,
  chatId: number,
  message?: AdminMessage,
): Promise<void> {
  if (product === 'course') {
    await renderConfirmStep(pricing, product, 0, pricing.teachers[0]?.teacherId, chatId, message);
    return;
  }

  const pack = pricing[product];
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...pack.options.map((option, index) => [
        { text: option.name, callback_data: `sp:k:${productCode(product)}:${index}` },
      ]),
      [{ text: '◀️ Назад', callback_data: 'sp:menu' }],
    ],
  };
  const text = `💳 ${ACCESS_PRODUCT_LABELS[product]}\n\nВыберите пакет:`;
  if (message) await editPurchaseMessage(message, text, keyboard);
  else await sendPurchaseMessage(chatId, text, keyboard);
}

async function renderTeacherStep(
  pricing: CabinetPricing,
  product: AccessProduct,
  packageIndex: number,
  chatId: number,
  message?: AdminMessage,
): Promise<void> {
  const teachers = pricing.teachers;
  if (teachers.length <= 1) {
    await renderConfirmStep(pricing, product, packageIndex, teachers[0]?.teacherId, chatId, message);
    return;
  }

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...teachers.map((teacher, index) => [
        {
          text: teacher.name,
          callback_data: `sp:t:${productCode(product)}:${packageIndex}:${index}`,
        },
      ]),
      [{ text: '◀️ Назад', callback_data: `sp:p:${productCode(product)}` }],
    ],
  };
  const pack = product === 'course' ? null : pricing[product];
  const option = pack?.options[packageIndex];
  const text = `💳 ${ACCESS_PRODUCT_LABELS[product]}\n${option?.name ?? ''}\n\nВыберите преподавателя:`;
  if (message) await editPurchaseMessage(message, text, keyboard);
  else await sendPurchaseMessage(chatId, text, keyboard);
}

async function renderConfirmStep(
  pricing: CabinetPricing,
  product: AccessProduct,
  packageIndex: number,
  teacherId: string | undefined,
  chatId: number,
  message?: AdminMessage,
): Promise<void> {
  const offer = await resolveOffer(pricing, product, packageIndex, teacherId);
  const teacherIdx = teacherId ? pricing.teachers.findIndex((t) => t.teacherId === teacherId) : 0;
  const safeTeacherIdx = teacherIdx >= 0 ? teacherIdx : 0;
  const text =
    `💳 Подтверждение заявки\n\n` +
    `${offer.title}\n` +
    `Сумма: ${formatMoney(offer.amountByn)}\n\n` +
    `После подтверждения администратор свяжется с вами для оплаты. Доступ появится в личном кабинете после одобрения.`;

  const backData =
    product === 'course'
      ? 'sp:menu'
      : pricing.teachers.length > 1
        ? `sp:k:${productCode(product)}:${packageIndex}`
        : `sp:p:${productCode(product)}`;

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: '✅ Отправить заявку',
          callback_data: `sp:y:${productCode(product)}:${packageIndex}:${safeTeacherIdx}`,
        },
      ],
      [{ text: '◀️ Назад', callback_data: backData }],
    ],
  };

  if (message) await editPurchaseMessage(message, text, keyboard);
  else await sendPurchaseMessage(chatId, text, keyboard);
}

async function submitPurchaseRequest(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  product: AccessProduct,
  packageIndex: number,
  teacherIndex: number,
  message?: AdminMessage,
): Promise<void> {
  const pricing = await getCabinetPricing();
  const teacher = pricing.teachers[teacherIndex] ?? pricing.teachers[0];
  const teacherId = product === 'course' ? null : teacher?.teacherId ?? null;

  const existing = await findPendingPurchaseRequest(admin, telegramId, product, packageIndex, teacherId);
  if (existing) {
    const text =
      `⏳ У вас уже есть заявка на этот продукт.\n\n` +
      `${existing.title}\n` +
      `Сумма: ${formatMoney(Number(existing.amount_byn))}\n\n` +
      `Дождитесь ответа администратора или откройте кабинет:\n${getBaseUrlString()}/cabinet?section=payments`;
    if (message) await editPurchaseMessage(message, text);
    else await sendPurchaseMessage(chatId, text);
    return;
  }

  const offer = await resolveOffer(pricing, product, packageIndex, teacherId ?? undefined);
  let request: PurchaseRequestRow;
  try {
    request = await createPurchaseRequest(admin, {
      telegramId,
      product,
      packageIndex,
      teacherId,
      title: offer.title,
      amountByn: offer.amountByn,
    });
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      const text = 'Раздел покупок временно недоступен. Попробуйте позже или напишите администратору.';
      if (message) await editPurchaseMessage(message, text);
      else await sendPurchaseMessage(chatId, text);
      return;
    }
    throw error;
  }

  try {
    await notifyAdminsOfNewPurchaseRequest(admin, request);
  } catch (error) {
    console.error('[purchase] admin notify failed:', error);
  }

  const text =
    `✅ Заявка отправлена\n\n` +
    `${offer.title}\n` +
    `Сумма: ${formatMoney(offer.amountByn)}\n\n` +
    `Администратор свяжется с вами для оплаты. Статус заявки — в разделе «Оплаты» личного кабинета.`;

  if (message) await editPurchaseMessage(message, text);
  else await sendPurchaseMessage(chatId, text);
}

export async function beginStudentPurchase(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: PurchaseStartOptions = {},
): Promise<void> {
  const linked = await isTelegramLinked(admin, telegramId);
  if (!linked) {
    await sendPurchaseMessage(
      chatId,
      `💳 Покупка доступна после привязки Telegram к аккаунту.\n\nОткройте личный кабинет на сайте и подключите бота:\n${getBaseUrlString()}/cabinet`,
    );
    return;
  }

  const pricing = await getCabinetPricing();
  const { product, packageIndex, teacherIndex } = options;

  if (!product) {
    await renderProductMenu(chatId);
    return;
  }

  if (product === 'course') {
    const teacherId = pricing.teachers[0]?.teacherId;
    await renderConfirmStep(pricing, product, 0, teacherId, chatId);
    return;
  }

  const pkgIdx = packageIndex ?? 0;
  const pack = pricing[product];
  if (!pack.options[pkgIdx]) {
    await renderPackageStep(pricing, product, chatId);
    return;
  }

  if (teacherIndex != null && pricing.teachers[teacherIndex]) {
    await renderConfirmStep(pricing, product, pkgIdx, pricing.teachers[teacherIndex].teacherId, chatId);
    return;
  }

  if (pricing.teachers.length > 1 && teacherIndex == null) {
    await renderTeacherStep(pricing, product, pkgIdx, chatId);
    return;
  }

  await renderConfirmStep(pricing, product, pkgIdx, pricing.teachers[0]?.teacherId, chatId);
}

export async function handleStudentPurchaseCallback(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const acknowledge = async (text?: string, showAlert = false) => {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    }
  };

  if (!isStudentPurchaseAction(data)) return false;
  await acknowledge();

  const linked = await isTelegramLinked(admin, telegramId);
  if (!linked) {
    await editPurchaseMessage(
      message,
      `Сначала привяжите Telegram в личном кабинете:\n${getBaseUrlString()}/cabinet`,
    );
    return true;
  }

  try {
    const pricing = await getCabinetPricing();

    if (data === 'sp:menu') {
      await renderProductMenu(message.chatId, message);
      return true;
    }

    // sp:p:<code>
    if (data.startsWith('sp:p:')) {
      const code = data.slice('sp:p:'.length);
      const product = productFromCode(code);
      if (!product) return true;
      await renderPackageStep(pricing, product, message.chatId, message);
      return true;
    }

    // sp:k:<code>:<pkg>
    if (data.startsWith('sp:k:')) {
      const [, , code, pkgRaw] = data.split(':');
      const product = productFromCode(code);
      if (!product) return true;
      const packageIndex = Math.max(0, Number(pkgRaw) || 0);
      await renderTeacherStep(pricing, product, packageIndex, message.chatId, message);
      return true;
    }

    // sp:t:<code>:<pkg>:<teacherIdx>
    if (data.startsWith('sp:t:')) {
      const [, , code, pkgRaw, teacherRaw] = data.split(':');
      const product = productFromCode(code);
      if (!product) return true;
      const packageIndex = Math.max(0, Number(pkgRaw) || 0);
      const teacherIndex = Math.max(0, Number(teacherRaw) || 0);
      const teacherId = pricing.teachers[teacherIndex]?.teacherId;
      await renderConfirmStep(pricing, product, packageIndex, teacherId, message.chatId, message);
      return true;
    }

    // sp:y:<code>:<pkg>:<teacherIdx>
    if (data.startsWith('sp:y:')) {
      const [, , code, pkgRaw, teacherRaw] = data.split(':');
      const product = productFromCode(code);
      if (!product) return true;
      const packageIndex = Math.max(0, Number(pkgRaw) || 0);
      const teacherIndex = Math.max(0, Number(teacherRaw) || 0);
      await submitPurchaseRequest(admin, telegramId, message.chatId, product, packageIndex, teacherIndex, message);
      return true;
    }
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await editPurchaseMessage(message, 'Раздел покупок временно недоступен. Попробуйте позже.');
      return true;
    }
    throw error;
  }

  return true;
}
