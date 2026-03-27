'use client';

import { useEffect, useRef } from 'react';
import { useForm } from '@/contexts/FormContext';
import { SignupModalForm } from '@/components';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function ModalPopup() {
  const { isOpen, closeForm } = useForm();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const scrollYRef = useRef<number>(0);

  useEffect(() => {
    if (!isOpen) return;

    const body = document.body;
    const html = document.documentElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevScrollBehavior = html.style.scrollBehavior;
    const scrollY = window.scrollY;
    scrollYRef.current = scrollY;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      const restoreY = scrollYRef.current;
      html.style.scrollBehavior = 'auto';
      requestAnimationFrame(() => {
        window.scrollTo(0, restoreY);
        html.style.scrollBehavior = prevScrollBehavior;
      });
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      lastActiveRef.current = document.activeElement as HTMLElement | null;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeForm();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closeForm]);

  useEffect(() => {
    if (!isOpen) {
      lastActiveRef.current?.focus?.({ preventScroll: true } as any);
      return;
    }

    const content = contentRef.current;
    if (!content) return;

    const focusables = Array.from(
      content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );

    (focusables[0] ?? content).focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const items = Array.from(
        content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled'));

      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onClick={closeForm}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Запись на занятие"
        ref={contentRef}
        onClick={(e) => e.stopPropagation()}
      >
        <SignupModalForm />
      </div>
    </div>
  );
}
