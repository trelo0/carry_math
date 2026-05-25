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
  image: any;
  caption?: string;
}

export interface Teacher {
  _id: string; // обязательное для Sanity
  name: string;
  subject: string;
  description: string;
  photo: any; // Sanity Image
  hasSpots: boolean;
  trialLesson: {
    price: string;
    duration?: string;
    description: string;
  };
  services: Service[];
  reviews?: TeacherReview[];
}

export interface Course {
  _id: string;
  icon: string;
  title: string;
  description: string;
  order?: number;
}

export interface MethodStep {
  _id: string;
  title: string;
  description: string;
}

export interface ProcessStep {
  _id: string;
  title: string;
  description: string;
}

export interface Problem {
  _id: string;
  title: string;
  description: string;
}