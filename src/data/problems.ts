export interface Problem {
  id: number;
  title: string;
  description: string;
}

export const problems: Problem[] = [
  {
    id: 1,
    title: 'Низкий балл',
    description: 'Текущая успеваемость ниже желаемой',
  },
  {
    id: 2,
    title: 'Страх экзаменов',
    description: 'Волнение и неуверенность перед ЕГЭ/ОГЭ',
  },
  {
    id: 3,
    title: 'Нет мотивации',
    description: 'Отсутствие интереса к предмету',
  },
  {
    id: 4,
    title: 'Пробелы в знаниях',
    description: 'Непонимание ключевых тем',
  },
];
