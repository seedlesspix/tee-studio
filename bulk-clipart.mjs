// bulk-clipart.mjs
// Run with: node bulk-clipart.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Read .env.local
const env = readFileSync('.env.local', 'utf8')
const getEnv = (key) => {
  const match = env.match(new RegExp(`${key}=(.+)`))
  return match ? match[1].trim() : null
}

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_KEY = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

console.log('Connecting to:', SUPABASE_URL)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const BUCKET = 'clipart'
const BASE_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`

const folderToCategory = {
  'Animals':           'Animals',
  'Activities':        'Activities',
  'Chicago':           'Chicago',
  'Events':            'Events',
  'Food':              'Food & Drink',
  'Food-Drink':        'Food & Drink',
  'Food_Drink':        'Food & Drink',
  'Food & Drink':      'Food & Drink',
  'Holidays':          'Holidays',
  'Politics':          'Politics/Protest',
  'Politics-Protest':  'Politics/Protest',
  'Politics_Protest':  'Politics/Protest',
  'Pride':             'Pride',
  'Sports':            'Sports',
  'Symbols':           'Symbols',
}

async function main() {
  const { data: categories, error: catError } = await supabase
    .from('clipart_categories')
    .select('id, name')

  if (catError) {
    console.error('Error fetching categories:', catError.message)
    return
  }

  const categoryMap = {}
  categories.forEach(c => { categoryMap[c.name] = c.id })
  console.log('Categories found:', Object.keys(categoryMap).join(', '))

  const { data: folders, error: folderError } = await supabase.storage
    .from(BUCKET)
    .list('')

  if (folderError) {
    console.error('Error listing folders:', folderError.message)
    return
  }

  console.log('Folders found:', folders?.map(f => f.name).join(', '))

  const inserts = []

  for (const folder of (folders || [])) {
    if (folder.name === '.emptyFolderPlaceholder') continue

    const categoryName = folderToCategory[folder.name] || folder.name
    const categoryId = categoryMap[categoryName]

    if (!categoryId) {
      console.log(`⚠️  No category match for folder: "${folder.name}"`)
      continue
    }

    const { data: files, error: fileError } = await supabase.storage
      .from(BUCKET)
      .list(folder.name, { limit: 1000 })

    if (fileError) {
      console.error(`Error listing files in ${folder.name}:`, fileError.message)
      continue
    }

    console.log(`${folder.name} -> "${categoryName}": ${files?.length || 0} files`)

    for (const file of (files || [])) {
      if (file.name === '.emptyFolderPlaceholder') continue

      const ext = file.name.split('.').pop()?.toLowerCase()
      const fileType = ext === 'svg' ? 'svg' : 'png'
      const fileUrl = `${BASE_URL}/${folder.name}/${encodeURIComponent(file.name)}`
      const name = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())

      inserts.push({
        category_id: categoryId,
        name: name,
        file_url: fileUrl,
        file_type: fileType,
        print_method_key: 'screen_print',
        sort_order: 0,
        is_active: true
      })
    }
  }

  console.log(`\nTotal clipart to insert: ${inserts.length}`)

  if (inserts.length === 0) {
    console.log('Nothing to insert - check your folder names match the mapping above')
    return
  }

  for (let i = 0; i < inserts.length; i += 100) {
    const batch = inserts.slice(i, i + 100)
    const { error } = await supabase.from('clipart_items').insert(batch)
    if (error) {
      console.error(`Error inserting batch:`, error.message)
    } else {
      console.log(`✓ Inserted items ${i + 1} to ${Math.min(i + 100, inserts.length)}`)
    }
  }

  console.log('\n✅ Done! All clipart inserted into database.')
}

main().catch(console.error)
