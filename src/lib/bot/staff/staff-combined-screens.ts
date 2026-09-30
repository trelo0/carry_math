import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { withTeacherCabinetRow } from './teacher-cabinet-ui';
import { withCuratorCabinetRow } from './curator-cabinet-ui';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

export function renderCombinedStudentsHub(cabinetUrl: string | null): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '👥 МОИ УЧЕНИКИ\n\nВыберите контекст:',
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🎓 Ученики курса', callback_data: 's:stu:c' }],
          [{ text: '👤 Индивидуальные', callback_data: 's:stu:i' }],
          [{ text: '👥 Мини-группы', callback_data: 's:stu:g' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderCombinedHomeworkHub(cabinetUrl: string | null): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '📝 ДОМАШНИЕ ЗАДАНИЯ\n\nДва независимых контура — выберите:',
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🏫 Задания по занятиям', callback_data: 's:hw:t' }],
          [{ text: '🎓 Задания по курсу', callback_data: 's:hw:c' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderCombinedMessagesHub(cabinetUrl: string | null): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '💬 СООБЩЕНИЯ\n\nПереписка разделена по контексту:',
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          [{ text: '🏫 Ученики по занятиям', callback_data: 's:msg:t' }],
          [{ text: '🎓 Ученики курса', callback_data: 's:msg:c' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}
