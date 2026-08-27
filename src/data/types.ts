// src/data/types.ts
export interface Service {
  name: string;
  price: string;
  duration?: string;
  spotsStatus?:
    | {
        type: 'many' | 'none' | 'few' | 'custom';
        count?: number;
        text?: string;
      }
    | 'many'
    | 'none';
}

export interface TeacherReview {
  _key: string;
  image: unknown;
  caption?: string;
  teacherName?: string;
}

export interface Teacher {
  _id: string;
  name: string;
  subject: string;
  description: string;
  photo: unknown;
  badges?: string[];
  hasSpots: boolean;
  trialLesson: {
    price: string;
    duration?: string;
    description: string;
  };
  services: Service[];
  reviews?: TeacherReview[];
}

export interface Stat {
  _id: string;
  value: string;
  label: string;
  order?: number;
}

export interface Principle {
  _id: string;
  title: string;
  description: string;
  order?: number;
}

export interface ProcessStep {
  _id: string;
  title: string;
  description: string;
}
