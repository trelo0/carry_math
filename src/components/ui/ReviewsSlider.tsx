'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { TeacherReview } from '@/data/types';
import { urlFor } from '@/lib/sanity';

type ReviewWithTeacher = TeacherReview & { teacherName?: string };

interface ReviewsSliderProps {
  reviews: ReviewWithTeacher[];
}

export default function ReviewsSlider({ reviews }: ReviewsSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('reviews-portal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reviews-portal';
      document.body.appendChild(el);
    }
    setPortalEl(el);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - trackRef.current.offsetLeft);
    setScrollLeft(trackRef.current.scrollLeft);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !trackRef.current) return;
    e.preventDefault();
    const x = e.pageX - trackRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    trackRef.current.scrollLeft = scrollLeft - walk;
  }, [isDragging, startX, scrollLeft]);

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  };

  const prevSlide = () => {
    if (lightboxIndex === null) return;
    setLightboxIndex((lightboxIndex - 1 + reviews.length) % reviews.length);
  };

  const nextSlide = () => {
    if (lightboxIndex === null) return;
    setLightboxIndex((lightboxIndex + 1) % reviews.length);
  };

  const lightbox =
    lightboxIndex !== null && portalEl
      ? createPortal(
          (() => {
            const review = reviews[lightboxIndex];
            if (!review) return null;
            let src: string | null = null;
            if (typeof review.image === 'string') {
              src = review.image;
            } else if (review.image) {
              src = urlFor(review.image).width(900).url();
            }
            if (!src) return null;
            const teacherLabel = review.teacherName || 'Преподаватель';
            const studentName = review.caption || 'Отзыв';

            return (
              <div
                className="reviews-lightbox"
                onClick={closeLightbox}
                role="dialog"
                aria-modal="true"
                aria-label="Просмотр отзыва"
              >
                <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
                  <button className="lightbox-close" onClick={closeLightbox} aria-label="Закрыть">✕</button>
                  {reviews.length > 1 && (
                    <button className="lightbox-arrow lightbox-prev" onClick={prevSlide} aria-label="Предыдущий">‹</button>
                  )}
                  <div className="lightbox-img-wrap">
                    <Image
                      src={src}
                      alt={review.caption || `Отзыв ${lightboxIndex + 1}`}
                      fill
                      sizes="(max-width: 768px) 95vw, 700px"
                      className="lightbox-img"
                    />
                  </div>
                  <div className="lightbox-caption-wrap">
                    <span className="review-teacher chip">{teacherLabel}</span>
                    <p className="lightbox-caption">{studentName}</p>
                  </div>
                  {reviews.length > 1 && (
                    <button className="lightbox-arrow lightbox-next" onClick={nextSlide} aria-label="Следующий">›</button>
                  )}
                  <p className="lightbox-counter">{lightboxIndex + 1} / {reviews.length}</p>
                </div>
              </div>
            );
          })(),
          portalEl
        )
      : null;

  if (!reviews.length) return null;

  return (
    <>
      <div className="reviews-slider">
        <div
          className={`reviews-track${isDragging ? ' dragging' : ''}`}
          ref={trackRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {reviews.map((review, index) => {
            let src: string | null = null;
            if (typeof review.image === 'string') {
              src = review.image;
            } else if (review.image) {
              src = urlFor(review.image).width(400).url();
            }
            if (!src) return null;
            const teacherLabel = review.teacherName || 'Преподаватель';
            const studentName = review.caption || 'Отзыв';
            return (
              <div
                key={review._key}
                className="review-card"
                onClick={() => openLightbox(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openLightbox(index)}
                aria-label={`Отзыв ${index + 1} — ${teacherLabel}`}
              >
                <div className="review-top">
                  <div className="review-meta">
                    <span className="review-student">{studentName}</span>
                  </div>
                  <span className="review-teacher chip">{teacherLabel}</span>
                </div>
                <div className="review-img-wrap">
                  <Image
                    src={src}
                    alt={review.caption || `Отзыв ${index + 1}`}
                    fill
                    sizes="220px"
                    className="review-img"
                    draggable={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {lightbox}
    </>
  );
}
