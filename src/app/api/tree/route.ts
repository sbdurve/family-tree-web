export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { getDB } from '@/lib/db';

export async function GET() {
  try {
    const db = getDB();

    const [peopleRes, spousesRes, linksRes, galleriesRes] = await Promise.all([
      db
        .prepare("SELECT id, full_name, parent_id, tooltip, image_url FROM people WHERE status = 'approved' ORDER BY created_at ASC")
        .all(),
      db
        .prepare('SELECT id, full_name, person_id, image_url FROM spouses ORDER BY id ASC')
        .all(),
      db
        .prepare('SELECT id, person_id, url, description, display_html FROM links ORDER BY id ASC')
        .all(),
      db
        .prepare('SELECT id, description, gdrive_link, display_order FROM galleries ORDER BY display_order ASC, id ASC')
        .all(),
    ]);

    return Response.json(
      {
        people: peopleRes.results,
        spouses: spousesRes.results,
        links: linksRes.results,
        galleries: galleriesRes.results,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('GET /api/tree error:', err);
    return Response.json({ error: 'Failed to fetch tree data' }, { status: 500 });
  }
}
