'use client';

import { useEffect, useRef } from 'react';

/** Срабатывает один раз при входе в кабинет (CTA с главной для уже авторизованных). */
export default function CtaIntentConsumer() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void fetch('/api/cabinet/consume-cta-intent', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => {});
  }, []);
  return null;
}
