'use client';

type Props = {
  botUrl: string | null;
};

export default function CourseCabinetGate({ botUrl }: Props) {
  return (
    <section className="cab-panel cab-course-gate">
      <header className="cab-course-gate-head">
        <span className="cab-course-gate-k">Кабинет курса</span>
        <h2>Курс пока недоступен</h2>
      </header>
      <p className="cab-note">
        Программа курса ещё не опубликована. Напишите в поддержку школы — мы подскажем, как подключиться.
      </p>
      <div className="cab-course-gate-actions">
        {botUrl ? (
          <a className="cab-btn cab-btn--join" href={botUrl} target="_blank" rel="noopener noreferrer">
            Написать в Telegram
          </a>
        ) : null}
      </div>
    </section>
  );
}
