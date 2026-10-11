/** Проверить курсы в Supabase */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCourses() {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('id, title, slug, sanity_id, price_byn, granted_lessons')
      .order('id');

    if (error) throw error;

    console.log('Courses in Supabase:');
    data.forEach((course) => {
      console.log(`- ID: ${course.id}`);
      console.log(`  Title: ${course.title}`);
      console.log(`  Slug: ${course.slug}`);
      console.log(`  Sanity ID: ${course.sanity_id}`);
      console.log(`  Price: ${course.price_byn} BYN`);
      console.log(`  Lessons: ${course.granted_lessons}`);
      console.log();
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkCourses();
