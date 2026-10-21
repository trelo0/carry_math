/** Выбранный курс в admin TG hub «Жизни» (ключ — chatId админа). */
const adminLivesHubCourseByChat = new Map<number, number>();

export function setAdminLivesHubCourse(chatId: number, courseId: number): void {
  adminLivesHubCourseByChat.set(chatId, courseId);
}

export function getAdminLivesHubCourse(chatId: number): number | undefined {
  return adminLivesHubCourseByChat.get(chatId);
}
