'use client';

import { useState } from 'react';
import type { CabinetCourseStop } from '@/lib/cabinet';

type Step = 'file' | 'comment' | 'status';

export default function HomeworkSubmitModal({
  stop,
  mode,
  onClose,
  onSubmitted,
}: {
  stop: CabinetCourseStop;
  mode: 'submit' | 'check_status';
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [step, setStep] = useState<Step>(mode === 'check_status' ? 'status' : 'file');
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonId = stop.sanityLessonId;
  if (!lessonId) return null;

  const handleSend = async () => {
    setError(null);
    setLoading(true);
    try {
      let fileUrl: string | undefined;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const up = await fetch(`/api/cabinet/course/lessons/${encodeURIComponent(lessonId)}/homework/upload`, {
          method: 'POST',
          body: form,
        });
        const upData = (await up.json().catch(() => null)) as { fileUrl?: string; error?: string } | null;
        if (!up.ok) {
          setError(upData?.error ?? 'Не удалось загрузить файл');
          return;
        }
        fileUrl = upData?.fileUrl;
      }

      if (!fileUrl && !comment.trim()) {
        setError('Прикрепите файл или напишите комментарий');
        return;
      }

      const res = await fetch(`/api/cabinet/course/lessons/${encodeURIComponent(lessonId)}/homework/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: comment.trim() || undefined, fileUrl }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? 'Не удалось отправить ДЗ');
        return;
      }
      onSubmitted?.();
      onClose();
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal cab-modal--enroll cab-hw-submit-modal"
        role="dialog"
        aria-labelledby="hw-submit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="hw-submit-title">{mode === 'check_status' ? 'Статус домашнего задания' : 'Сдача домашнего задания'}</h3>
        <p className="cab-hw-submit-lesson">{stop.title}</p>

        {mode === 'check_status' ? (
          <>
            <p className="cab-hw-submit-hint">
              Домашнее задание отправлено куратору курса и ожидает проверки. Обычно ответ приходит в Telegram или в
              этом разделе.
            </p>
            <div className="cab-modal-actions">
              <button type="button" className="cab-btn cab-btn--join" onClick={onClose}>
                Понятно
              </button>
            </div>
          </>
        ) : step === 'file' ? (
          <>
            <p className="cab-hw-submit-hint">Шаг 1 — прикрепите файл с решением (PDF, фото или архив).</p>
            <label className="cab-hw-submit-file">
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.zip,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span>{file ? file.name : 'Выбрать файл'}</span>
            </label>
            {error ? <p className="cab-modal-error">{error}</p> : null}
            <div className="cab-modal-actions">
              <button type="button" className="cab-btn cab-btn--line" onClick={onClose}>
                Отмена
              </button>
              <button
                type="button"
                className="cab-btn cab-btn--join"
                disabled={!file}
                onClick={() => {
                  setError(null);
                  setStep('comment');
                }}
              >
                Далее
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="cab-hw-submit-hint">Шаг 2 — комментарий для куратора (необязательно).</p>
            <textarea
              className="cab-hw-submit-comment"
              rows={4}
              placeholder="Пояснение к решению…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {error ? <p className="cab-modal-error">{error}</p> : null}
            <div className="cab-modal-actions">
              <button type="button" className="cab-btn cab-btn--line" onClick={() => setStep('file')} disabled={loading}>
                Назад
              </button>
              <button type="button" className="cab-btn cab-btn--line" onClick={onClose} disabled={loading}>
                Отмена
              </button>
              <button type="button" className="cab-btn cab-btn--join" onClick={() => void handleSend()} disabled={loading}>
                {loading ? 'Отправка…' : 'Отправить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
