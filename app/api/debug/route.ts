import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET_length: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.length,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET_first8: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.slice(0, 8),
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET_last8: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.slice(-8),
    SHOPIFY_STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')}/auth/customer/callback`,
  })
}