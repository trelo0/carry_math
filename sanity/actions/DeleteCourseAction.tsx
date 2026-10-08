import {useCallback, useState} from 'react'
import {useClient} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'

function bareId(id: string): string {
  return id.replace(/^drafts\./, '')
}

/**
 * Удаляет курс вместе с модулями/занятиями и снимает ссылки,
 * чтобы Sanity не блокировал delete из‑за references (module.course → course).
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

      const modules = await client.fetch<{_id: string}[]>(
        `*[_type == "districtModule" && (course._ref == $courseId || course._ref == $draftCourseId)]{_id}`,
        {courseId, draftCourseId: `drafts.${courseId}`},
      )

      const moduleBareIds = [...new Set((modules ?? []).map((m) => bareId(m._id)))]
      const moduleRefVariants = moduleBareIds.flatMap((mid) => [mid, `drafts.${mid}`])

      const lessons =
        moduleBareIds.length > 0
          ? await client.fetch<{_id: string}[]>(
              `*[_type == "districtCourseLesson" && module._ref in $moduleRefs]{_id}`,
              {moduleRefs: moduleRefVariants},
            )
          : []

      const lessonBareIds = [...new Set((lessons ?? []).map((l) => bareId(l._id)))]
      const tx = client.transaction()

      // Снять ссылки занятий из module.lessons (только у реально существующих docs)
      for (const mod of modules ?? []) {
        for (const lessonId of lessonBareIds) {
          tx.patch(mod._id, (p) =>
            p.unset([
              `lessons[_ref=="${lessonId}"]`,
              `lessons[_ref=="drafts.${lessonId}"]`,
            ]),
          )
        }
      }

      for (const lessonId of lessonBareIds) {
        tx.delete(`drafts.${lessonId}`)
        tx.delete(lessonId)
      }

      for (const mid of moduleBareIds) {
        tx.delete(`drafts.${mid}`)
        tx.delete(mid)
      }

      if (published) {
        tx.patch(courseId, (p) => p.unset(['modules']))
        tx.delete(courseId)
      }
      if (draft || id.startsWith('drafts.')) {
        tx.patch(`drafts.${courseId}`, (p) => p.unset(['modules']))
        tx.delete(`drafts.${courseId}`)
      }
      // На случай, если открыт только published id, но draft тоже есть
      if (published && !draft) {
        tx.delete(`drafts.${courseId}`)
      }

      await tx.commit({visibility: 'async'})
      onComplete()
    } catch (error) {
      console.error('[DeleteCourseAction]', error)
      window.alert(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить курс. Сначала удалите связанные модули или попробуйте ещё раз.',
      )
    } finally {
      setBusy(false)
      setDialogOpen(false)
    }
  }, [client, draft, id, onComplete, published])

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
