import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = readFileSync('.env.local', 'utf8')
const getEnv = (key) => {
  const match = env.match(new RegExp(`${key}=(.+)`))
  return match ? match[1].trim() : null
}

const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
const BUCKET = 'clipart'
const BASE_URL = `${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/${BUCKET}`

const folders = [
  { folder: 'Animals',          category: 'Animals' },
  { folder: 'Activities',       category: 'Activities' },
  { folder: 'Chicago',          category: 'Chicago' },
  { folder: 'Events',           category: 'Events' },
  { folder: 'Food & Drink',     category: 'Food & Drink' },
  { folder: 'Holidays',         category: 'Holidays' },
  { folder: 'Politics/Protest', category: 'Politics/Protest' },
  { folder: 'Pride',            category: 'Pride' },
  { folder: 'Sports',           category: 'Sports' },
  { folder: 'Symbols',          category: 'Symbols' },
]

async function main() {
  const { data: categories } = await supabase
    .from('clipart_categories').select('id, name')
  const categoryMap = {}
  categories.forEach(c => { categoryMap[c.name] = c.id })

  const inserts = []

  for (const { folder, category } of folders) {
    const categoryId = categoryMap[category]
    if (!categoryId) { console.log(`⚠️  No DB category for: ${category}`); continue }

    const { data: files, error } = await supabase.storage
      .from(BUCKET).list(folder, { limit: 1000 })

    if (error) { console.log(`❌ ${folder}: ${error.message}`); continue }
    if (!files || files.length === 0) { console.log(`📂 ${folder}: empty or not found`); continue }

    const realFiles = files.filter(f => f.name !== '.emptyFolderPlaceholder')
    console.log(`✓ ${folder}: ${realFiles.length} files`)

    for (const file of realFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      inserts.push({
        category_id: categoryId,
        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        file_url: `${BASE_URL}/${folder}/${encodeURIComponent(file.name)}`,
        file_type: ext === 'svg' ? 'svg' : 'png',
        print_method_key: 'screen_print',
        sort_order: 0,
        is_active: true
      })
    }
  }

  console.log(`\nTotal to insert: ${inserts.length}`)
  if (inserts.length === 0) return

  for (let i = 0; i < inserts.length; i += 100) {
    const { error } = await supabase.from('clipart_items').insert(inserts.slice(i, i + 100))
    if (error) console.error('Error:', error.message)
    else console.log(`✓ Inserted ${i + 1} to ${Math.min(i + 100, inserts.length)}`)
  }
  console.log('\n✅ Done!')
}

main().catch(console.error)