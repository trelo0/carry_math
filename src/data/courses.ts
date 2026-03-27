export interface Course {
  id: number;
  icon: string;
  title: string;
  description: string;
}

export const courses: Course[] = [
  {
    id: 1,
    icon: '∑',
    title: 'Алгебра 7-9 класс',
    description: 'Полный курс алгебры для средней школы. От линейных уравнений до функций.',
  },
  {
    id: 2,
    icon: '∫',
    title: 'Геометрия 7-9 класс',
    description: 'Изучение планиметрии и стереометрии. Теоремы, доказательства, задачи.',
  },
  {
    id: 3,
    icon: 'π',
    title: 'Подготовка к ЦЭ/ЦТ',
    description: 'Интенсивная подготовка к экзамену. Разбор всех типов заданий.',
  }
];
