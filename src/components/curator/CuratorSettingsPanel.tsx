'use client';

import { useAuth } from '@/contexts/AuthContext';

export default function CuratorSettingsPanel({
  curatorName,
  courseTitle,
  sanityWriteEnabled,
}: {
  curatorName: string | null;
  courseTitle: string;
  sanityWriteEnabled: boolean;
}) {
  const { openAuth } = useAuth();

  return (
    <div className="curator-panel">
      <h1 className="curator-title">Настройки</h1>

      <section className="curator-card">
        <h2>Профиль</h2>
        <p>{curatorName ?? 'Куратор'}</p>
        <p className="curator-muted">Курс: {courseTitle}</p>
        <button type="button" className="curator-link" onClick={() => openAuth('/cabinet/curator')}>
          Сменить аккаунт
        </button>
      </section>

      <section className="curator-card">
        <h2>Sanity CMS</h2>
        <p className="curator-muted">
          {sanityWriteEnabled
            ? 'Редактирование занятий и загрузка файлов доступны.'
            : 'SANITY_API_WRITE_TOKEN не настроен — только просмотр и управление эфирами.'}
        </p>
      </section>

      <section className="curator-card">
        <h2>Telegram-бот</h2>
        <p className="curator-help">
          Ученики отправляют домашние задания через бота. Ответы автоматически попадают в раздел «Домашние задания».
          Уведомления об эфире, материалах и записи отправляются из карточки занятия.
        </p>
      </section>

      <section className="curator-card">
        <h2>Как работает эфир</h2>
        <ol className="curator-steps">
          <li>Укажите дату и ссылку на YouTube в занятии и сохраните.</li>
          <li>Когда начнёте трансляцию на YouTube — нажмите «Начать вебинар».</li>
          <li>Ученики увидят плеер и чат только после этого.</li>
          <li>После эфира нажмите «Закончить занятие» и при необходимости добавьте ссылку на запись.</li>
        </ol>
      </section>
    </div>
  );
}
