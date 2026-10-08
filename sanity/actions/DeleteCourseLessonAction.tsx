import {useCallback, useState} from 'react'
import {useClient} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'
import {bareId, filterOutRefs, idPair, type SanityRef} from './courseDeleteUtils'

/**
 * Удаляет занятие и предварительно убирает ссылки из module.lessons
 * (и draft, и published), чтобы Sanity не блокировал delete.
 */
export const DeleteCourseLessonAction: DocumentActionComponent = (
  props: DocumentActionProps,
) => {
  const {id, type, published, draft, onComplete} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      const lessonId = bareId(id)
      const lessonRefs = idPair(lessonId)

      const modules = await client.fetch<{_id: string}[]>(
        `*[_type == "districtModule" && (references($lessonId) || references($draftLessonId))]{_id}`,
        {lessonId, draftLessonId: `drafts.${lessonId}`},
      )

      const moduleIds = new Set<string>()
      for (const mod of modules ?? []) {
        for (const mid of idPair(mod._id)) moduleIds.add(mid)
      }

      const [moduleDocs, lessonDocs] = await Promise.all([
        moduleIds.size > 0
          ? client.fetch<{_id: string; lessons?: SanityRef[]}[]>(
              `*[_id in $ids]{_id, lessons}`,
              {ids: [...moduleIds]},
            )
          : Promise.resolve([]),
        client.fetch<{_id: string}[]>(`*[_id in $ids]{_id}`, {ids: lessonRefs}),
      ])

      const tx = client.transaction()

      for (const mod of moduleDocs) {
        tx.patch(mod._id, (p) => p.set({lessons: filterOutRefs(mod.lessons, lessonRefs)}))
      }

      // Снять module у занятия перед delete (legacy strong refs)
      for (const lesson of lessonDocs) {
        tx.patch(lesson._id, (p) => p.unset(['module']))
      }

      tx.delete(`drafts.${lessonId}`)
      tx.delete(lessonId)
      await tx.commit({visibility: 'async'})
      onComplete()
    } catch (error) {
      console.error('[DeleteCourseLessonAction]', error)
      window.alert(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить занятие. Попробуйте ещё раз.',
      )
    } finally {
      setBusy(false)
      setDialogOpen(false)
    }
  }, [client, id, onComplete])

  const doc = draft ?? published
  if (type !== 'districtCourseLesson' || !doc) return null

  return {
    label: 'Удалить',
    tone: 'critical',
    disabled: busy,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'confirm',
          tone: 'critical',
          message: 'Удалить занятие? Ссылки из модуля будут сняты автоматически.',
          onConfirm: handleDelete,
          onCancel: () => setDialogOpen(false),
        }
      : undefined,
  }
}
