import Image from 'next/image';
import { useForm } from '@/contexts/FormContext';
import { Teacher } from '@/data/types';
import { urlFor } from '@/lib/sanity';

interface TeacherCardProps {
  teacher: Teacher;
  buttonText?: string;
}

export default function TeacherCard({ teacher, buttonText }: TeacherCardProps) {
  const { openForm } = useForm();

  const photoSrc =
    typeof teacher.photo === 'string'
      ? teacher.photo
      : teacher.photo
        ? urlFor(teacher.photo).width(300).height(300).url()
        : '';

  const normalizeSpotsStatus = (spotsStatus: any) => {
    if (!spotsStatus) return { type: 'many' as const };
    if (typeof spotsStatus === 'string') return { type: spotsStatus };
    return {
      type: spotsStatus.type,
      count: spotsStatus.count,
      text: spotsStatus.text,
    };
  };

  // Проверяем, есть ли доступные услуги
  const hasAvailableServices = teacher.services.some(
    (s) => normalizeSpotsStatus(s.spotsStatus).type !== 'none'
  );

  // Кнопка блокируется если:
  // 1. hasSpots = false И все услуги недоступны
  const isTrialBlocked = !teacher.hasSpots && !hasAvailableServices;

  const pluralizeRu = (n: number, one: string, few: string, many: string) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = n % 10;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  };

  const handleTrialClick = () => {
    openForm({
      teacher: teacher.name,
      service: 'Пробное занятие',
      price: teacher.trialLesson.price,
    });
  };

  const renderSpotsStatus = (service: typeof teacher.services[0]) => {
    const status = normalizeSpotsStatus(service.spotsStatus);

    if (!status || status.type === 'many') return null;

    if (status.type === 'none') {
      return <span className="service-spots-none">⏳ Набор временно закрыт</span>;
    }

    if (status.type === 'few') {
      const count = typeof status.count === 'number' ? status.count : null;
      if (!count || count <= 0) return null;
      const word = pluralizeRu(count, 'место', 'места', 'мест');
      return <span className="service-spots-few">🔥 Осталось {count} {word}</span>;
    }

    if (status.type === 'custom') {
      if (!status.text) return null;
      return <span className="service-spots-custom">📢 {status.text}</span>;
    }

    return null;
  };

  return (
    <div className="teacher-card">
      <div className="teacher-photo">
        <Image
          src={photoSrc}
          alt={teacher.name}
          width={140}
          height={140}
          sizes="140px"
        />
      </div>
      <h3>{teacher.name}</h3>
      <p className="teacher-subject">{teacher.subject}</p>
      <p className="teacher-desc">{teacher.description}</p>

      <div className="teacher-services-info">
        <p className="services-title">Форматы обучения:</p>
        {teacher.services.map((service, index) => (
          <div key={index} className="service-info-item">
            {renderSpotsStatus(service)}
            <div className="service-details">
              <span className="service-name">
                {service.name}
                {service.duration && <span className="service-duration"> • {service.duration}</span>}
              </span>
              <span className="service-price">{service.price}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="trial-lesson-block">
        <div className="trial-header">
          <span className="trial-name">
            Пробное занятие
            {teacher.trialLesson.duration && <span className="trial-duration"> • {teacher.trialLesson.duration}</span>}
          </span>
          <span className="trial-price">{teacher.trialLesson.price}</span>
        </div>
        <p className="trial-description">{teacher.trialLesson.description}</p>
        <button
          type="button"
          className="btn btn-primary btn-trial"
          onClick={handleTrialClick}
          disabled={isTrialBlocked}
        >
          {buttonText || 'Записаться на пробное занятие'}
        </button>
      </div>

    </div>
  );
}
