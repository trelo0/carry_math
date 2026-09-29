export type LessonBookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export type LessonBookingView = {
  id: string;
  studentTelegramId: number;
  studentName: string | null;
  teacherTelegramId: number;
  kind: 'individual' | 'group';
  groupId: number | null;
  groupTitle: string | null;
  packageId: number | null;
  startsAt: string;
  durationMinutes: number;
  status: LessonBookingStatus;
  scheduledLessonId: number | null;
  createdAt: string;
};

export type BookingSlotView = {
  startsAt: string;
  endAt: string;
  label: string;
};
