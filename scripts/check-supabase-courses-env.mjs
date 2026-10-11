/** Проверить курсы в Supabase через Supabase JS из env */

import { createClient } from '@supabase/supabase-js';

// Загружаем .env.local
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve('.env.local');
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      if (key === 'NEXT_PUBLIC_SUPABASE_URL') supabaseUrl = value;
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = value;
    });
  } catch (e) {
    console.log('Could not read .env.local');
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.log('SUPABASE_URL:', supabaseUrl);
  console.log('SUPABASE_KEY:', supabaseKey ? 'set' : 'not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCourses() {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('id, title, slug, sanity_id')
      .order('id');

    if (error) throw error;

    console.log('Courses in Supabase:');
    data.forEach((course) => {
      console.log(`- ID: ${course.id}`);
      console.log(`  Title: ${course.title}`);
      console.log(`  Slug: ${course.slug}`);
      console.log(`  Sanity ID: ${course.sanity_id}`);
      console.log();
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkCourses();
