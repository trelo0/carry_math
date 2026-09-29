import type { ActionFeedback } from '@/lib/staff/run-action';

type Props = {
  feedback?: ActionFeedback | null;
  className?: string;
};

export default function CabinetFeedback({ feedback, className }: Props) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      className={`cabinet-feedback cabinet-feedback--${feedback.type}${className ? ` ${className}` : ''}`}
    >
      {feedback.message}
    </p>
  );
}
