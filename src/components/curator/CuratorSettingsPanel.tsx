'use client';

import { useAuth } from '@/contexts/AuthContext';

export default function CuratorSettingsPanel({
  curatorName,
  courseTitle,
  sanityWriteEnabled,
  showTeacher = false,
  showCurator = true,
}: {
  curatorName: string | null;
  courseTitle: string;
  sanityWriteEnabled: boolean;
  showTeacher?: boolean;
  showCurator?: boolean;
}) {
  const { openAuth } = useAuth();
  const teacherOnly = showTeacher && !showCurator;

  return (
    <div className="curator-panel">
      <h1 className="curator-title">Настройки</h1>

      <section className="curator-card">
        <h2>Профиль</h2>
        <p>{curatorName ?? (teacherOnly ? 'Преподаватель' : 'Куратор')}</p>
        {showCurator ? <p className="curator-muted">Курс: {courseTitle}</p> : null}
        <button type="button" className="curator-link" onClick={() => openAuth('/cabinet/staff')}>
          Сменить аккаунт
        </button>
      </section>

      {teacherOnly ? (
        <section className="curator-card">
          <h2>Обычные занятия</h2>
          <p className="curator-help">
            Расписание, ученики и группы — в разделах «Расписание», «Ученики» и «Группы». Занятие открывается из
            календаря: ссылки, материалы, перенос и завершение — в боковой панели.
          </p>
        </section>
      ) : null}

      {showCurator ? (
        <>
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
              Ученики отправляют домашние задания через бота. Ответы автоматически попадают в раздел «Домашние
              задания». Уведомления об эфире, материалах и записи отправляются из карточки занятия.
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
        </>
      ) : null}

      {showTeacher && showCurator ? (
        <section className="curator-card">
          <h2>Обычные занятия</h2>
          <p className="curator-help">
            Личные и групповые занятия — в «Расписание». Курс — в блоке «Курсы» слева. В карточке ученика видны оба
            контекста.
          </p>
        </section>
      ) : null}
    </div>
  );
}
