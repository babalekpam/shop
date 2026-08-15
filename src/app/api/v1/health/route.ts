import { NextResponse } from 'next/server';
import { LOCALES } from '../../../../i18n/routing';

/**
 * Liveness probe (build spec §7).
 *
 * Reports only what an operator needs and a stranger may see. No versions of
 * dependencies, no environment values, no hostnames — a health endpoint is a public
 * surface and every extra field in it is reconnaissance.
 *
 * The gateway flags report *configured or not*, never the keys themselves, so a deploy
 * can be verified without reading secrets.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    locales: LOCALES.length,
    gateways: {
      paddle: !!process.env.PADDLE_API_KEY,
      cinetpay: !!process.env.CINETPAY_API_KEY,
    },
    database: !!process.env.DATABASE_URL,
  });
}
