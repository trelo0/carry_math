import {useCallback, useState} from 'react'
import {useClient, useDocumentOperation} from 'sanity'
import type {DocumentActionComponent, DocumentActionProps} from 'sanity'
import {bareId, idPair, type SanityRef} from './courseDeleteUtils'

async function appendLessonToModuleLessons(
  client: ReturnType<typeof useClient>,
  moduleId: string,
  lessonId: string,
): Promise<void> {
  const lessonRefs = idPair(lessonId)
  const moduleIds = idPair(bareId(moduleId))

  const moduleDocs = await client.fetch<{_id: string; lessons?: SanityRef[]}[]>(
    `*[_id in $ids]{_id, lessons}`,
    {ids: [...moduleIds]},
  )

  const tx = client.transaction()
  for (const mod of moduleDocs ?? []) {
    const lessons = mod.lessons ?? []
    const already = lessons.some((ref) => ref?._ref != null && lessonRefs.includes(ref._ref))
    if (already) continue
    tx.patch(mod._id, (p) =>
      p.set({
        lessons: [
          ...lessons,
          {_type: 'reference', _ref: bareId(lessonId), _weak: true, _key: `lesson-${bareId(lessonId)}`},
        ],
      }),
    )
  }
  if ((moduleDocs ?? []).length > 0) {
    await tx.commit({visibility: 'async'})
  }
}

/** Публикация занятия + ссылка в module.lessons (список в Studio). */
export const PublishCourseLessonAction: DocumentActionComponent = (props: DocumentActionProps) => {
  const {id, type, draft, published} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const {publish} = useDocumentOperation(id, type)
  const [busy, setBusy] = useState(false)

  const doc = draft ?? published
  const moduleRef = (doc as {module?: {_ref?: string}} | null)?.module?._ref

  const onHandle = useCallback(async () => {
    setBusy(true)
    try {
      await publish.execute()
      if (moduleRef) {
        await appendLessonToModuleLessons(client, moduleRef, bareId(id))
      }
    } catch (error) {
      console.error('[PublishCourseLessonAction]', error)
      window.alert(error instanceof Error ? error.message : 'Не удалось опубликовать занятие.')
    } finally {
      setBusy(false)
    }
  }, [client, id, moduleRef, publish])

  if (type !== 'districtCourseLesson' || !doc) return null
  if (!draft) return null

  return {
    label: 'Опубликовать',
    disabled: Boolean(publish.disabled) || busy,
    onHandle,
  }
}
