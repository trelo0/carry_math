import {useCallback, useState} from 'react'
import {useClient} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'
import {bareId, filterOutRefs, idPair, type SanityRef} from './courseDeleteUtils'

/**
 * Удаляет курс вместе с модулями/занятиями и снимает ссылки
 * (draft + published), чтобы Sanity не блокировал delete.
 */
export const DeleteCourseAction: DocumentActionComponent = (props: DocumentActionProps) => {
  const {id, type, published, draft, onComplete} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      const courseId = bareId(id)
      const courseRefs = idPair(courseId)

      const modulesByCourse = await client.fetch<{_id: string}[]>(
        `*[_type == "districtModule" && course._ref in $courseRefs]{_id}`,
        {courseRefs},
      )

      const courseDocs = await client.fetch<{_id: string; modules?: SanityRef[]}[]>(
        `*[_id in $ids]{_id, modules}`,
        {ids: courseRefs},
      )

      const moduleBareIds = new Set<string>()
      for (const mod of modulesByCourse ?? []) moduleBareIds.add(bareId(mod._id))
      for (const course of courseDocs) {
        for (const ref of course.modules ?? []) {
          if (ref?._ref) moduleBareIds.add(bareId(ref._ref))
        }
      }

      const moduleRefVariants = [...moduleBareIds].flatMap((mid) => idPair(mid))

      const lessons =
        moduleBareIds.size > 0
          ? await client.fetch<{_id: string}[]>(
              `*[_type == "districtCourseLesson" && module._ref in $moduleRefs]{_id}`,
              {moduleRefs: moduleRefVariants},
            )
          : []

      const lessonBareIds = [...new Set((lessons ?? []).map((l) => bareId(l._id)))]

      const moduleDocs =
        moduleRefVariants.length > 0
          ? await client.fetch<{_id: string; lessons?: SanityRef[]}[]>(
              `*[_id in $ids]{_id, lessons}`,
              {ids: moduleRefVariants},
            )
          : []

      const tx = client.transaction()

      // 1) Снять legacy course.modules
      for (const course of courseDocs) {
        tx.patch(course._id, (p) => p.unset(['modules']))
      }

      // 2) Очистить module.lessons / module.course
      for (const mod of moduleDocs) {
        tx.patch(mod._id, (p) =>
          p.set({lessons: filterOutRefs(mod.lessons, lessonBareIds.flatMap(idPair))}).unset([
            'course',
          ]),
        )
      }

      // 3) Удалить занятия → модули → курс
      for (const lessonId of lessonBareIds) {
        tx.delete(`drafts.${lessonId}`)
        tx.delete(lessonId)
      }

      for (const mid of moduleBareIds) {
        tx.delete(`drafts.${mid}`)
        tx.delete(mid)
      }

      tx.delete(`drafts.${courseId}`)
      tx.delete(courseId)

      await tx.commit({visibility: 'async'})
      onComplete()
    } catch (error) {
      console.error('[DeleteCourseAction]', error)
      window.alert(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить курс. Попробуйте ещё раз.',
      )
    } finally {
      setBusy(false)
      setDialogOpen(false)
    }
  }, [client, id, onComplete])

  const doc = draft ?? published
  if (type !== 'districtCourse' || !doc) return null

  return {
    label: 'Удалить курс',
    tone: 'critical',
    disabled: busy,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'confirm',
          tone: 'critical',
          message:
            'Удалить курс вместе с его модулями и занятиями? Это действие необратимо.',
          onConfirm: handleDelete,
          onCancel: () => setDialogOpen(false),
        }
      : undefined,
  }
}
