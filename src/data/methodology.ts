export interface MethodStep {
  id: number;
  title: string;
  description: string;
}

export const methodSteps: MethodStep[] = [
  {
    id: 1,
    title: 'Диагностика',
    description: 'Определяем текущий уровень и выявляем пробелы',
  },
  {
    id: 2,
    title: 'План обучения',
    description: 'Составляем персональную программу',
  },
  {
    id: 3,
    title: 'Живые занятия',
    description: 'Уроки с преподавателем онлайн',
  },
  {
    id: 4,
    title: 'Контроль',
    description: 'Регулярные тесты и отслеживание прогресса',
  }
];
