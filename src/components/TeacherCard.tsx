'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { useForm } from '@/contexts/FormContext';
import { Teacher } from '@/data/types';
import { urlFor } from '@/lib/sanity';

interface TeacherCardProps {
  teacher: Teacher;
  buttonText?: string;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}

export default function TeacherCard({ teacher, buttonText, expanded, onToggle }: TeacherCardProps) {
  const { openForm } = useForm();
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleScroll = () => {
      if (!expanded) return;
      const rect = card.getBoundingClientRect();
      if (rect.bottom < 0) {
        onToggle(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [expanded, onToggle]);

  const photoSrc =
    typeof teacher.photo === 'string'
      ? teacher.photo
      : teacher.photo
        ? urlFor(teacher.photo).width(600).height(900).url()
        : '';

  const descriptionLines = teacher.description
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalizeSpotsStatus = (spotsStatus: unknown) => {
    if (!spotsStatus) return { type: 'many' as const };
    if (typeof spotsStatus === 'string') return { type: spotsStatus };
    if (typeof spotsStatus === 'object' && spotsStatus !== null) {
      const s = spotsStatus as { type?: string; count?: number; text?: string };
      return {
        type: s.type,
        count: s.count,
        text: s.text,
      };
    }
    return { type: 'many' as const };
  };

  const hasAvailableServices = teacher.services.some(
    (s) => normalizeSpotsStatus(s.spotsStatus).type !== 'none',
  );

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

  const renderSpotsStatus = (service: (typeof teacher.services)[0]) => {
    const status = normalizeSpotsStatus(service.spotsStatus);

    if (!status || status.type === 'many') return null;

    if (status.type === 'none') {
      return <span className="service-spots-none">Набор временно закрыт</span>;
    }

    if (status.type === 'few') {
      const count = typeof status.count === 'number' ? status.count : null;
      if (!count || count <= 0) return null;
      const word = pluralizeRu(count, 'место', 'места', 'мест');
      return (
        <span className="service-spots-few">
          Осталось {count} {word}
        </span>
      );
    }

    if (status.type === 'custom') {
      if (!status.text) return null;
      return <span className="service-spots-custom">{status.text}</span>;
    }

    return null;
  };

  return (
    <article
      ref={cardRef}
      className={`teacher-card${expanded ? ' teacher-card--expanded' : ''}`}
    >
      <div className="teacher-card-poster">
        {photoSrc ? (
          <Image
            src={photoSrc}
            alt={teacher.name}
            width={600}
            height={900}
            className="teacher-card-photo"
            sizes="(max-width: 768px) 100vw, 300px"
          />
        ) : (
          <div className="teacher-card-photo-placeholder" />
        )}
      </div>

      <div className="teacher-card-body">
        <div className="teacher-card-main">
          <div className="teacher-card-name-row">
            <h3>{teacher.name}</h3>
            <span className="teacher-card-subject">{teacher.subject}</span>
          </div>
          <ul className="teacher-card-description">
            {descriptionLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="teacher-card-expandable" aria-hidden={!expanded}>
          <div>
            <div className="teacher-services-info">
              <p className="services-title">Форматы обучения</p>
              {teacher.services.map((service, index) => (
                <div key={index} className="service-info-item">
                  {renderSpotsStatus(service)}
                  <div className="service-details">
                    <span className="service-name">
                      {service.name}
                      {service.duration && (
                        <span className="service-duration"> • {service.duration}</span>
                      )}
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
                  {teacher.trialLesson.duration && (
                    <span className="trial-duration"> • {teacher.trialLesson.duration}</span>
                  )}
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
        </div>

        <button
          type="button"
          className="teacher-card-toggle"
          onClick={() => onToggle(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? 'Свернуть' : 'Узнать больше'}
          <span className="teacher-card-toggle-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>
    </article>
  );
}
