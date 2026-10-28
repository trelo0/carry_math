type Props = {
  title: string;
  phase: number;
  hint?: string;
};

/** Заглушка раздела до подключения данных (этапы 2–4). */
export default function AdminSectionStub({ title, phase, hint }: Props) {
  return (
    <div className="admin-panel__stub">
      <div className="admin-panel__card admin-panel__card--muted">
        <h2 className="admin-panel__card-title">{title}</h2>
        <p className="admin-panel__empty-text">
          Раздел подключится на этапе {phase} реализации панели.
          {hint ? ` ${hint}` : ''}
        </p>
      </div>
    </div>
  );
}
