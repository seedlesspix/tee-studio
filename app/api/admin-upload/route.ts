import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '../../lib/supabase/server'

const anonClient = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Admin gate is now the `admins` list (BETA #23) via is_admin(), not the ADMIN_EMAILS env var.
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!user?.email || !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File
  const categoryId = formData.get('categoryId') as string
  const categoryName = formData.get('categoryName') as string
  const printMethodKey = formData.get('printMethodKey') as string
  const sortOrder = parseInt(formData.get('sortOrder') as string) || 0

  if (!file || !categoryId) {
    return NextResponse.json({ error: 'Missing file or categoryId' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase()
  const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
  const path = `${categoryName}/${safeName}_${Date.now()}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await anonClient.storage
    .from('clipart')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: `Storage: ${uploadError.message}` }, { status: 500 })
  }

  const { data: urlData } = anonClient.storage.from('clipart').getPublicUrl(path)

  const { data: newItem, error: insertError } = await anonClient
    .from('clipart_items')
    .insert({
      category_id: categoryId,
      name: safeName.replace(/_/g, ' '),
      file_url: urlData.publicUrl,
      file_type: ext === 'svg' ? 'svg' : 'image',
      print_method_key: printMethodKey,
      is_active: true,
      sort_order: sortOrder,
      tags: []
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: `DB: ${insertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ item: newItem })
}
