import { Box, Stack, Text, TextInput } from '@sanity/ui'
import { set, unset, useFormValue, type InputProps } from 'sanity'

type CabinetTeacher = { teacherId?: string; name?: string }
type TeacherPrice = { _key?: string; teacherId?: string; priceByn?: number }

export function TeacherPricesInput(props: InputProps) {
  const teachers = (useFormValue(['teachers']) as CabinetTeacher[] | undefined) ?? []
  const value = (props.value as TeacherPrice[] | undefined) ?? []

  const updatePrice = (teacherId: string, raw: string) => {
    const trimmed = raw.trim()
    const filtered = value.filter((item) => item.teacherId !== teacherId)
    if (!trimmed) {
      props.onChange(filtered.length ? set(filtered) : unset())
      return
    }
    const priceByn = Number(trimmed.replace(',', '.'))
    if (Number.isNaN(priceByn)) return
    props.onChange(
      set([
        ...filtered,
        {
          _key: teacherId,
          _type: 'teacherPrice',
          teacherId,
          priceByn,
        },
      ]),
    )
  }

  if (teachers.length === 0) {
    return (
      <Box padding={3}>
        <Text muted size={1}>
          Сначала добавьте преподавателей в блоке «Преподаватели» выше.
        </Text>
      </Box>
    )
  }

  return (
    <Stack space={3}>
      {teachers.map((teacher) => {
        if (!teacher.teacherId) return null
        const current = value.find((item) => item.teacherId === teacher.teacherId)
        return (
          <Box key={teacher.teacherId}>
            <Text size={1} weight="medium">
              {teacher.name ?? teacher.teacherId}
            </Text>
            <TextInput
              type="number"
              min={0}
              step={1}
              placeholder="Цена, BYN"
              value={current?.priceByn ?? ''}
              onChange={(event) => updatePrice(teacher.teacherId!, event.currentTarget.value)}
            />
          </Box>
        )
      })}
    </Stack>
  )
}
