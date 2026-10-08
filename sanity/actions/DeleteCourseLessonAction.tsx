import {useCallback, useState} from 'react'
import {useClient} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'

/**
 * Удаляет занятие и предварительно убирает ссылки из module.lessons,
 * чтобы Sanity не блокировал delete из‑за references.
 *
 * Важно: все hooks — до любых early return (иначе падает structure tool).
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
      const lessonId = id.replace(/^drafts\./, '')
      const modules = await client.fetch<{_id: string}[]>(
        `*[_type == "districtModule" && references($lessonId)]{_id}`,
        {lessonId},
      )

      const tx = client.transaction()
      for (const mod of modules ?? []) {
        tx.patch(mod._id, (p) =>
          p.unset([
            `lessons[_ref=="${lessonId}"]`,
            `lessons[_ref=="drafts.${lessonId}"]`,
          ]),
        )
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
