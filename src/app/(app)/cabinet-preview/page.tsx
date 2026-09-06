import CabinetShell from '@/components/cabinet/CabinetShell';

// ВРЕМЕННАЯ dev-страница для превью кабинета без авторизации. Удалить после проверки.
const DEMO_CREATED_AT = new Date(Date.now() - 17 * 86_400_000).toISOString();

export default function CabinetPreviewPage() {
  return (
    <CabinetShell
      data={{
        phone: '+7 700 000-00-00',
        createdAt: DEMO_CREATED_AT,
        studentName: 'Иван Петров',
        telegramLinked: true,
        accesses: [
          { product: 'course', expiresAt: null },
          { product: 'individual', expiresAt: null },
          { product: 'group', expiresAt: null },
        ],
        enrollment: null,
        group: null,
        mentors: [],
      }}
    />
  );
}
