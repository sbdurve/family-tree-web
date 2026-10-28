import { getR2 } from '@/lib/db';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r2 = getR2();

    const object = await r2.get('data.xlsx');

    if (!object) {
      return new Response('data.xlsx not found in R2', {
        status: 404,
      });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':
          'attachment; filename="data.xlsx"',
      },
    });
  } catch (error) {
    console.error('Download data.xlsx error:', error);

    return new Response('Failed to download data.xlsx', {
      status: 500,
    });
  }
}
