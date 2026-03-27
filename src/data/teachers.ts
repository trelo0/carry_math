export interface Service {
  name: string;
  price: string;
  spotsStatus?: 'many' | 'none' | { type: 'few'; count: number } | { type: 'custom'; text: string };
  // many = много мест (не показываем ничего)
  // none = нет мест (⏳ Набор закрыт)
  // { type: 'few', count: 5 } = мало мест (🔥 Осталось 5 мест)
  // { type: 'custom', text: 'Ведётся набор на лето' } = свой статус
}

export interface Teacher {
  id: number;
  name: string;
  subject: string;
  description: string;
  photo: string;
  hasSpots: boolean;  // true = есть места, false = нет мест вообще
  trialBlocked?: boolean;  // вручную заблокировать пробное занятие
  trialLesson: {
    price: string;
    description: string;
  };
  services: Service[];
}

export const teachers: Teacher[] = [
  {
    id: 1,
    name: 'Кристина Колодинская',
    subject: 'Алгебра и начала анализа',
    description: 'Преподавательский стаж 12 лет. Эксперт ЦЭ/ЦТ. Объясняет сложные вещи простым языком.',
    photo: '/teachers/kris.jpg',
    hasSpots: true,
    trialLesson: {
      price: '20 BYN',
      description: 'С него начинается обучение. После занятия подберём подходящий формат.',
    },
    services: [
      { name: 'Индивидуальное занятие', price: '50 BYN', spotsStatus: 'none' },
      { name: 'Групповое занятие', price: '30 BYN', spotsStatus: { type: 'few', count: 5 } },
    ],
  },
  {
    id: 2,
    name: 'Мария Ковалёва',
    subject: 'Геометрия и стереометрия',
    description: 'Кандидат физико-математических наук. Разработала авторскую методику изучения геометрии.',
    photo: '/teachers/maria.jpg',
    hasSpots: false,
    trialBlocked: false,  
    trialLesson: {
      price: '25 BYN',
      description: 'С него начинается обучение. После занятия подберём подходящий формат.',
    },
    services: [
      { name: 'Индивидуальное занятие', price: '50 BYN', spotsStatus: 'none' },
      { name: 'Групповое занятие', price: '30 BYN', spotsStatus: { type: 'few', count: 5 } },
    ],
  },
];
