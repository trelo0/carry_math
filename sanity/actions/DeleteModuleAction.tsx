import {useCallback, useState} from 'react'
import {useClient} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'
import {bareId, filterOutRefs, idPair, type SanityRef} from './courseDeleteUtils'

/**
 * Удаляет модуль вместе с занятиями и снимает ссылки из course.modules
 * (draft + published), чтобы Sanity не блокировал delete.
 */
export const DeleteModuleAction: DocumentActionComponent = (props: DocumentActionProps) => {
  const {id, type, published, draft, onComplete} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      const moduleId = bareId(id)
      const moduleRefs = idPair(moduleId)

      const lessons = await client.fetch<{_id: string}[]>(
        `*[_type == "districtCourseLesson" && module._ref in $moduleRefs]{_id}`,
        {moduleRefs},
      )
      const lessonBareIds = [...new Set((lessons ?? []).map((l) => bareId(l._id)))]

      const courses = await client.fetch<{_id: string; modules?: SanityRef[]}[]>(
        `*[_type == "districtCourse" && (references($moduleId) || references($draftModuleId))]{
          _id,
          modules
        }`,
        {moduleId, draftModuleId: `drafts.${moduleId}`},
      )

      const courseIds = new Set<string>()
      for (const course of courses ?? []) {
        for (const cid of idPair(course._id)) courseIds.add(cid)
      }

      const courseDocs =
        courseIds.size > 0
          ? await client.fetch<{_id: string; modules?: SanityRef[]}[]>(
              `*[_id in $ids]{_id, modules}`,
              {ids: [...courseIds]},
            )
          : []

      const moduleDocs = await client.fetch<{_id: string}[]>(`*[_id in $ids]{_id}`, {
        ids: moduleRefs,
      })

      const tx = client.transaction()

      for (const course of courseDocs) {
        tx.patch(course._id, (p) =>
          p.set({modules: filterOutRefs(course.modules, moduleRefs)}),
        )
      }

      for (const mod of moduleDocs) {
        tx.patch(mod._id, (p) => p.unset(['lessons', 'course']))
      }

      for (const lessonId of lessonBareIds) {
        tx.delete(`drafts.${lessonId}`)
        tx.delete(lessonId)
      }

      tx.delete(`drafts.${moduleId}`)
      tx.delete(moduleId)

      await tx.commit({visibility: 'async'})
      onComplete()
    } catch (error) {
      console.error('[DeleteModuleAction]', error)
      window.alert(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить модуль. Попробуйте ещё раз.',
      )
    } finally {
      setBusy(false)
      setDialogOpen(false)
    }
  }, [client, id, onComplete])

  const doc = draft ?? published
  if (type !== 'districtModule' || !doc) return null

  return {
    label: 'Удалить модуль',
    tone: 'critical',
    disabled: busy,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'confirm',
          tone: 'critical',
          message: 'Удалить модуль вместе со всеми занятиями? Это действие необратимо.',
          onConfirm: handleDelete,
          onCancel: () => setDialogOpen(false),
        }
      : undefined,
  }
}
