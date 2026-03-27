'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface FormData {
  teacher: string;
  service: string;
  price: string;
  waitlist?: boolean;
  spotsStatus?: 'many' | 'few' | 'none';
}

interface FormContextType {
  isOpen: boolean;
  formData: FormData | null;
  openForm: (data: FormData) => void;
  closeForm: () => void;
}

const FormContext = createContext<FormContextType | undefined>(undefined);

export function FormProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<FormData | null>(null);

  const openForm = (data: FormData) => {
    setFormData(data);
    setIsOpen(true);
  };

  const closeForm = () => {
    setIsOpen(false);
    setFormData(null);
  };

  return (
    <FormContext.Provider value={{ isOpen, formData, openForm, closeForm }}>
      {children}
    </FormContext.Provider>
  );
}

export function useForm() {
  const context = useContext(FormContext);
  if (context === undefined) {
    throw new Error('useForm must be used within a FormProvider');
  }
  return context;
}
