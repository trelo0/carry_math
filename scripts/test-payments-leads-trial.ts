/**
 * Логические тесты потока оплаты/пробных (без реального bePaid).
 * Запуск: npx tsx scripts/test-payments-leads-trial.ts
 */
import assert from 'node:assert/strict';
import { lessonsRemainingToDeliver, isPaidLessonPackageOrder } from '../src/lib/bot/purchase-order-grant';
import type { PurchaseRequestRow } from '../src/lib/bot/purchase-requests';

function row(partial: Partial<PurchaseRequestRow> & Pick<PurchaseRequestRow, 'id' | 'telegram_id' | 'product' | 'status'>): PurchaseRequestRow {
  return {
    created_at: new Date().toISOString(),
    resolved_at: null,
    package_index: 0,
    teacher_id: null,
    title: 't',
    amount_byn: 10,
    resolved_by: null,
    course_slug: null,
    scenario: null,
    bepaid_transaction_uid: null,
    processing_version: 0,
    processing_updated_at: null,
    lessons_count: 8,
    lead_id: null,
    order_kind: 'package',
    lesson_format: 'individual',
    group_id: null,
    service_description: null,
    teacher_telegram_id: null,
    lessons_delivered: 0,
    ...partial,
  };
}

assert.equal(lessonsRemainingToDeliver(row({ id: '1', telegram_id: 1, product: 'individual', status: 'paid', lessons_count: 8, lessons_delivered: 0 })), 8);
assert.equal(lessonsRemainingToDeliver(row({ id: '2', telegram_id: 1, product: 'individual', status: 'paid', lessons_count: 8, lessons_delivered: 5 })), 3);
assert.equal(lessonsRemainingToDeliver(row({ id: '3', telegram_id: 1, product: 'individual', status: 'paid', lessons_count: 8, lessons_delivered: 8 })), 0);

assert.equal(isPaidLessonPackageOrder(row({ id: '4', telegram_id: 1, product: 'individual', status: 'paid' })), true);
assert.equal(isPaidLessonPackageOrder(row({ id: '5', telegram_id: 1, product: 'trial', status: 'paid', order_kind: 'trial' })), false);
assert.equal(isPaidLessonPackageOrder(row({ id: '6', telegram_id: 1, product: 'course', status: 'paid' })), false);

console.log('test-payments-leads-trial: ok');
