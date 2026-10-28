const PREVIEW_PARAM = 'cabinetPreview';

const cards = [
  {
    key: 'student',
    title: 'Кабинет ученика',
    text: 'Курсы, занятия, оплата и прогресс — как видит ученик.',
    href: `/cabinet?${PREVIEW_PARAM}=student`,
    accent: 'student' as const,
  },
  {
    key: 'curator',
    title: 'Кабинет куратора',
    text: 'Ученики, домашние задания и занятия выбранного курса.',
    href: `/cabinet/staff?section=course&courseRole=curator&${PREVIEW_PARAM}=curator`,
    accent: 'curator' as const,
  },
  {
    key: 'teacher',
    title: 'Кабинет учителя',
    text: 'Расписание, группы и занятия преподавателя.',
    href: `/cabinet/staff?section=teacher-calendar&${PREVIEW_PARAM}=teacher`,
    accent: 'teacher' as const,
  },
];

export default function AdminCabinetPreview() {
  return (
    <div className="admin-sf__cabinets">
      <p className="admin-sf__cabinets-lead">
        Откройте нужный кабинет в режиме просмотра. Внутри слева внизу кнопка «В настройки» вернёт на эту страницу.
      </p>
      <div className="admin-sf__cabinets-grid">
        {cards.map((c) => (
          <article key={c.key} className={`admin-sf__cabinet-card admin-sf__cabinet-card--${c.accent}`}>
            <span className="admin-sf__cabinet-card-badge">{c.title.replace('Кабинет ', '')}</span>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <a href={c.href} className="admin-sf__btn admin-sf__btn--primary admin-sf__cabinet-open">
              Открыть просмотр
            </a>
          </article>
        ))}
      </div>
    </div>
  );
}
