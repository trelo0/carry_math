import {readFileSync} from 'node:fs'
import {createClient} from 'next-sanity'

try {
  const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (!m || process.env[m[1]]) continue
    let v = m[2]
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
} catch {
  /* .env.local optional if env already set */
}

const token = process.env.SANITY_API_WRITE_TOKEN
if (!token) {
  console.error('SANITY_API_WRITE_TOKEN missing')
  process.exit(1)
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  token,
  useCdn: false,
})

const lessons = await client.fetch(
  `*[_type == "districtCourseLesson" && defined(module._ref) && module._weak != true]{_id, module}`,
)
const modules = await client.fetch(
  `*[_type == "districtModule" && (
      (defined(course._ref) && course._weak != true) ||
      count(lessons[_weak != true]) > 0
    )]{_id, course, lessons}`,
)

console.log('lessons to weaken', lessons.length)
console.log('modules to weaken', modules.length)

let tx = client.transaction()
let ops = 0

async function flush() {
  if (ops === 0) return
  await tx.commit({visibility: 'async'})
  tx = client.transaction()
  ops = 0
}

for (const lesson of lessons) {
  tx.patch(lesson._id, (p) =>
    p.set({
      module: {
        ...lesson.module,
        _type: 'reference',
        _weak: true,
      },
    }),
  )
  ops += 1
  if (ops >= 40) await flush()
}

for (const mod of modules) {
  const patch = {}
  if (mod.course?._ref && mod.course._weak !== true) {
    patch.course = {...mod.course, _type: 'reference', _weak: true}
  }
  if (Array.isArray(mod.lessons)) {
    patch.lessons = mod.lessons.map((ref) =>
      ref?._ref ? {...ref, _type: 'reference', _weak: true} : ref,
    )
  }
  if (Object.keys(patch).length > 0) {
    tx.patch(mod._id, (p) => p.set(patch))
    ops += 1
    if (ops >= 40) await flush()
  }
}

await flush()
console.log('DONE')
