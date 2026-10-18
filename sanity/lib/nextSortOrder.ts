import type {SanityClient} from '@sanity/client'

/** Следующий sortOrder (0, 1, 2…) для нового модуля в курсе. */
export async function nextModuleSortOrder(
  client: SanityClient,
  courseId: string,
): Promise<number> {
  const top = await client.fetch<number | null>(
    `*[_type == "districtModule" && course._ref == $courseId] | order(sortOrder desc)[0].sortOrder`,
    {courseId},
  )
  return (typeof top === 'number' && Number.isFinite(top) ? top : -1) + 1
}

/** Следующий moduleOrder (1, 2, 3…) для нового занятия в модуле. */
export async function nextLessonModuleOrder(
  client: SanityClient,
  moduleId: string,
): Promise<number> {
  const top = await client.fetch<number | null>(
    `*[_type == "districtCourseLesson" && module._ref == $moduleId] | order(moduleOrder desc)[0].moduleOrder`,
    {moduleId},
  )
  return (typeof top === 'number' && Number.isFinite(top) ? top : 0) + 1
}
