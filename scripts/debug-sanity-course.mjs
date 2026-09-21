import { createClient } from 'next-sanity';

const projectId = '2hngrocd';
const dataset = 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  useCdn: false,
  perspective: 'published',
});

try {
  const minimal = await client.fetch(
    `*[_type == "districtCourse" && _id == $docId][0]{ _id, title, "slug": slug.current }`,
    { docId: 'districtCourse.district-course' },
  );
  console.log('minimal:', JSON.stringify(minimal, null, 2));

  const modules = await client.fetch(
    `*[_type == "districtModule" && course._ref == $courseId] | order(sortOrder asc) {
      _id, title, "lessonCount": count(lessons), "firstLessonRef": lessons[0]._ref
    }`,
    { courseId: 'districtCourse.district-course' },
  );
  console.log('modules count:', modules?.length ?? 0);

  const full = await client.fetch(
    `*[_type == "districtCourse" && (slug.current == $slug || _id == $docId)][0]{
      "sanityId": _id,
      title,
      "slug": slug.current,
      "modulesFromRefs": *[_type == "districtModule" && course._ref == ^._id] | order(sortOrder asc) {
        "sanityId": _id, title, "lessons": lessons[]->{ "sanityId": _id, title, publicationStatus }
      }
    }`,
    { slug: 'district-course', docId: 'districtCourse.district-course' },
  );
  const modCount = full?.modulesFromRefs?.length ?? 0;
  const lessonCount = (full?.modulesFromRefs ?? []).reduce(
    (s, m) => s + (m.lessons?.filter(Boolean).length ?? 0),
    0,
  );
  console.log('full:', { found: Boolean(full), modCount, lessonCount, slug: full?.slug });
} catch (e) {
  console.error('ERROR:', e.message ?? e);
}
