'use client';

type Props = {
  courseTitle: string | null;
  botUrl: string | null;
  onOpenPayments: () => void;
  noCatalog: boolean;
};

export default function CourseCabinetGate({ courseTitle, botUrl, onOpenPayments, noCatalog }: Props) {
  const title = courseTitle ?? 'онлайн-курс District';

  return (
    <section className="cab-panel cab-course-gate">
      <header className="cab-course-gate-head">
        <span className="cab-course-gate-k">Кабинет курса</span>
        <h2>{noCatalog ? 'Курс пока недоступен' : 'Этот кабинет — для учеников онлайн-курса'}</h2>
      </header>
      {noCatalog ? (
        <p className="cab-note">
          Программа курса ещё не опубликована. Напишите в поддержку школы — мы подскажем, как подключиться.
        </p>
      ) : (
        <p className="cab-note">
          Индивидуальные и групповые занятия с преподавателем проходят в Telegram. Здесь — карта курса «{title}»,
          уроки, домашние задания и прогресс.
        </p>
      )}
      <div className="cab-course-gate-actions">
        {!noCatalog ? (
          <>
            <button type="button" className="cab-btn cab-btn--join" onClick={onOpenPayments}>
              Записаться на курс / оплатить
            </button>
            {botUrl ? (
              <a className="cab-btn cab-btn--line" href={botUrl} target="_blank" rel="noopener noreferrer">
                Открыть Telegram-бот
              </a>
            ) : null}
          </>
        ) : botUrl ? (
          <a className="cab-btn cab-btn--join" href={botUrl} target="_blank" rel="noopener noreferrer">
            Написать в Telegram
          </a>
        ) : null}
      </div>
    </section>
  );
}
