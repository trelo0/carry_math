-- Выполняйте этот файл, только если supabase/webinar_notification_templates.sql
-- был применён ранее в старой версии без offset_minutes_before.

alter table public.webinar_notification_templates
  add column if not exists offset_minutes_before integer;

update public.webinar_notification_templates
set offset_minutes_before = case reminder_type
  when '3_days' then 4320
  when '1_day' then 1440
  when '6_hours' then 360
  when '15_minutes' then 15
  else offset_minutes_before
end
where offset_minutes_before is null;

alter table public.webinar_notification_templates
  alter column offset_minutes_before set not null;

alter table public.webinar_notification_templates
  drop constraint if exists webinar_notification_templates_offset_minutes_before_check;

alter table public.webinar_notification_templates
  add constraint webinar_notification_templates_offset_minutes_before_check
  check (offset_minutes_before > 0);

alter table public.webinar_notification_templates
  drop constraint if exists webinar_notification_templates_reminder_type_check;

alter table public.webinar_notification_templates
  add constraint webinar_notification_templates_reminder_type_check
  check (
    reminder_type in ('3_days', '1_day', '6_hours', '15_minutes')
    or reminder_type ~ '^custom_[1-9][0-9]*_minutes$'
  );

create unique index if not exists webinar_notification_templates_unique_offset_idx
  on public.webinar_notification_templates (webinar_id, offset_minutes_before);

-- Добавляет четыре текущих шаблона для каждого уже существующего вебинара.
-- Сохранённые вручную шаблоны, тексты и файлы не перезаписываются.
insert into public.webinar_notification_templates (
  webinar_id,
  reminder_type,
  offset_minutes_before,
  message_text
)
select
  webinar.id::text,
  template.reminder_type,
  template.offset_minutes_before,
  template.message_text
from public.webinars as webinar
cross join (
  values
    (
      '3_days',
      4320,
      $$⚠️ ВНИМАНИЕ ВСЕМ СЕКТОРАМ!

Проверка систем жизнеобеспечения завершена. До нашего большого бесплатного онлайн-интенсива осталось ровно 3 дня! 🚀

Мы покажем тебе, как устроен District изнутри, и разберём реальные ловушки ЦТ из части Б, на которых теряют баллы даже сильные школьники. 🎯

Готовься. Арена уже близко. 🔥$$
    ),
    (
      '1_day',
      1440,
      $$🎒 СПОНСОРСКИЙ ПАРАШЮТ ДЛЯ ВЕБА!

До старта осталось 24 часа.

Завтра в {{webinar_time}} Арена District официально активируется. ⚡️

Чтобы ты пришёл на трансляцию заряженным, наши менторы приготовили для тебя микро-гайд:

📕 «Формулы тригонометрии, которые спасут тебя на ЦТ»

Забирай гайд уже сегодня и просмотри его до начала вебинара. 📚

А завтра мы покажем, как эти формулы работают в реальном бою и где именно школьники чаще всего попадаются на ловушки ЦТ. 🎯

До встречи на Арене. Завтра в {{webinar_time}}! 🔥$$
    ),
    (
      '6_hours',
      360,
      $$⚡️ ДЕНЬ ИКС НАСТАЛ, ТРИБУТ!

Сбор фракции объявлен. Сегодня в {{webinar_time}} мы выходим на Арену District. 🏟️

Готовь тетрадку, ручку и чай ☕️ — Лидия Владимировна проведёт разбор ловушек ЦТ, после которого ты начнёшь щёлкать тригонометрию как орехи. 🧠🔥

⏱ Таймер запущен.

Ровно через 6 часов в этом чате откроется прямой телепорт на вебинар.

Будь на связи. 🚀$$
    ),
    (
      '15_minutes',
      15,
      $$⚡️ ТЕЛЕПОРТ АКТИВИРОВАН

Лидия Владимировна уже в эфире, а менторы заняли свои позиции в чате поддержки. 🧑‍🏫🔥

Мы начинаем взлом ЦТ прямо сейчас.

Залетай на Арену по кнопке ниже, пока система не ограничила доступ! 👇

🎯 Твои 80+ баллов начинаются здесь.$$ 
    )
) as template(reminder_type, offset_minutes_before, message_text)
on conflict (webinar_id, offset_minutes_before) do nothing;
