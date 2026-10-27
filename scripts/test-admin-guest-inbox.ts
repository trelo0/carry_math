import assert from 'node:assert/strict';
import {
  formatGuestCourseInquiryBody,
  parseCourseTitleFromInquiryBody,
} from '../src/lib/bot/guest-course-inquiry-flow';

function parseReplyCallback(data: string) {
  const rest = data.slice('ah:gin:r:'.length);
  const parts = rest.split(':');
  return {
    clientTelegramId: Number(parts[0]),
    staffMsgId: Number(parts[1]),
    kind: parts[2] === 'course_inquiry' ? 'course_inquiry' : 'support',
  };
}

assert.equal(parseCourseTitleFromInquiryBody('[Курс: Математика]\n\nПривет'), 'Математика');
assert.equal(parseCourseTitleFromInquiryBody('no tag'), undefined);

const body = formatGuestCourseInquiryBody('Математика', '  Вопрос  ');
assert.ok(body.includes('[Курс: Математика]'));
assert.ok(body.includes('Вопрос'));

const cb = parseReplyCallback('ah:gin:r:748782191:1685717:course_inquiry');
assert.equal(cb.clientTelegramId, 748782191);
assert.equal(cb.staffMsgId, 1685717);
assert.equal(cb.kind, 'course_inquiry');

const cb2 = parseReplyCallback('ah:gin:r:100:5:support');
assert.equal(cb2.kind, 'support');

assert.ok('ah:gin:r:748782191:1685717:course_inquiry'.length <= 64);

console.log('test-admin-guest-inbox: ok');
