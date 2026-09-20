import Link from 'next/link';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

export default function CabinetTelegramGate() {
  const connectUrl = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}` : null;

  return (
    <div className="cabinet">
      <div className="cab-main cab-tg-gate-wrap">
        <section className="cab-panel cab-tg-gate">
          <h1>Нужен Telegram</h1>
          <p>
            Личный кабинет работает только с привязанным Telegram. Войди через номер телефона на странице входа —
            бот пришлёт код после подключения аккаунта.
          </p>
          {connectUrl ? (
            <a className="cab-btn cab-btn--join" href={connectUrl} target="_blank" rel="noopener noreferrer">
              Открыть бота District
            </a>
          ) : null}
          <Link className="cab-tg-gate-back" href="/login">
            Вернуться ко входу
          </Link>
        </section>
      </div>
    </div>
  );
}
