// ---------------------------------------------------------------------------
// MOCK-данные интерфейса преподавателя (этап проверки UX).
//
// Только тестовые данные: без телефонов, Telegram ID и контактов.
// В Supabase ничего не записывается, реальные связи teacher → student
// не создаются. При подключении учебной системы этот слой заменяется
// запросами к courses/groups/mentor_assignments.
// ---------------------------------------------------------------------------

export type TeacherStudentFormat = 'individual' | 'group';

export type MockStudent = {
  id: string;
  name: string;
  format: TeacherStudentFormat;
  status: 'active';
  homeworkCount: number;
};

export type MockGroupMember = {
  id: string;
  name: string;
};

export type MockGroup = {
  id: string;
  title: string;
  status: 'active';
  members: MockGroupMember[];
};

export type HomeworkStatus = 'pending' | 'checked';

export type HomeworkSubmission = {
  id: string;
  studentName: string;
  // Формат ученика: индивидуальные занятия или мини-группа.
  format: TeacherStudentFormat;
  number: number;
  status: HomeworkStatus;
  // Только для работ мини-групп.
  groupTitle?: string;
};

export type GroupHomeworkSummary = {
  groupId: string;
  groupTitle: string;
  pendingCount: number;
};

export const MOCK_INDIVIDUAL_STUDENTS: MockStudent[] = [
  { id: 'i1', name: 'Иван Петров', format: 'individual', status: 'active', homeworkCount: 5 },
  { id: 'i2', name: 'Мария Сидорова', format: 'individual', status: 'active', homeworkCount: 3 },
  { id: 'i3', name: 'Алексей Ковалёв', format: 'individual', status: 'active', homeworkCount: 2 },
];

export const MOCK_GROUPS: MockGroup[] = [
  {
    id: 'g1',
    title: '10А — Математика',
    status: 'active',
    members: [
      { id: 'm1', name: 'Алексей' },
      { id: 'm2', name: 'Мария' },
      { id: 'm3', name: 'Дмитрий' },
      { id: 'm4', name: 'Анна' },
    ],
  },
  {
    id: 'g2',
    title: '11Б — Подготовка к ЦТ',
    status: 'active',
    members: [
      { id: 'm1', name: 'Кирилл' },
      { id: 'm2', name: 'София' },
      { id: 'm3', name: 'Максим' },
      { id: 'm4', name: 'Елена' },
    ],
  },
];

// Работы индивидуальных учеников: номер соответствует условному
// количеству ДЗ ученика (последняя сданная работа).
export const MOCK_INDIVIDUAL_HOMEWORK: HomeworkSubmission[] = [
  { id: 'hi1', studentName: 'Иван Петров', format: 'individual', number: 5, status: 'pending' },
  { id: 'hi2', studentName: 'Мария Сидорова', format: 'individual', number: 3, status: 'pending' },
  { id: 'hi3', studentName: 'Алексей Ковалёв', format: 'individual', number: 2, status: 'checked' },
];

// Работы мини-групп: по одной на ученика группы.
export const MOCK_GROUP_HOMEWORK: HomeworkSubmission[] = [
  { id: 'hg1-1', studentName: 'Алексей', format: 'group', number: 4, status: 'pending', groupTitle: '10А — Математика' },
  { id: 'hg1-2', studentName: 'Мария', format: 'group', number: 4, status: 'pending', groupTitle: '10А — Математика' },
  { id: 'hg1-3', studentName: 'Дмитрий', format: 'group', number: 4, status: 'pending', groupTitle: '10А — Математика' },
  { id: 'hg1-4', studentName: 'Анна', format: 'group', number: 4, status: 'checked', groupTitle: '10А — Математика' },
  { id: 'hg2-1', studentName: 'Кирилл', format: 'group', number: 3, status: 'pending', groupTitle: '11Б — Подготовка к ЦТ' },
  { id: 'hg2-2', studentName: 'София', format: 'group', number: 3, status: 'pending', groupTitle: '11Б — Подготовка к ЦТ' },
  { id: 'hg2-3', studentName: 'Максим', format: 'group', number: 3, status: 'checked', groupTitle: '11Б — Подготовка к ЦТ' },
  { id: 'hg2-4', studentName: 'Елена', format: 'group', number: 3, status: 'checked', groupTitle: '11Б — Подготовка к ЦТ' },
];

export function getMockIndividualStudents(): MockStudent[] {
  return MOCK_INDIVIDUAL_STUDENTS;
}

export function getMockStudent(studentId: string): MockStudent | undefined {
  return MOCK_INDIVIDUAL_STUDENTS.find((student) => student.id === studentId);
}

export function getMockGroups(): MockGroup[] {
  return MOCK_GROUPS;
}

export function getMockGroup(groupId: string): MockGroup | undefined {
  return MOCK_GROUPS.find((group) => group.id === groupId);
}

export function getMockGroupMember(groupId: string, memberId: string): MockGroupMember | undefined {
  return getMockGroup(groupId)?.members.find((member) => member.id === memberId);
}

export function getIndividualHomeworkByStatus(status: HomeworkStatus): HomeworkSubmission[] {
  return MOCK_INDIVIDUAL_HOMEWORK.filter((item) => item.status === status);
}

export function getGroupHomeworkForGroup(groupId: string): HomeworkSubmission[] {
  const group = getMockGroup(groupId);
  if (!group) return [];
  return MOCK_GROUP_HOMEWORK.filter((item) => item.groupTitle === group.title);
}

// Сводка «требуют проверки» по группам для списка ДЗ мини-групп.
export function getMockGroupHomeworkSummaries(): GroupHomeworkSummary[] {
  return MOCK_GROUPS.map((group) => ({
    groupId: group.id,
    groupTitle: group.title,
    pendingCount: getGroupHomeworkForGroup(group.id).filter((item) => item.status === 'pending').length,
  }));
}

export function getHomeworkSubmission(submissionId: string): HomeworkSubmission | undefined {
  return (
    MOCK_INDIVIDUAL_HOMEWORK.find((item) => item.id === submissionId) ??
    MOCK_GROUP_HOMEWORK.find((item) => item.id === submissionId)
  );
}
