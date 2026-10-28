import * as XLSX from 'xlsx';
import { getDB, getR2 } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdmin(request)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  try {
    const db = getDB();

    const [peopleRes, spousesRes, linksRes, galleriesRes] =
      await Promise.all([
        db.prepare(
          `SELECT id, full_name, parent_id, tooltip, image_url, status
           FROM people
           ORDER BY id ASC`
        ).all(),

        db.prepare(
          `SELECT id, full_name, person_id, image_url
           FROM spouses
           ORDER BY id ASC`
        ).all(),

        db.prepare(
          `SELECT id, person_id, url, description, display_html
           FROM links
           ORDER BY id ASC`
        ).all(),

        db.prepare(
          `SELECT id, description, gdrive_link, display_order
           FROM galleries
           ORDER BY display_order ASC, id ASC`
        ).all(),
      ]);

    const people = peopleRes.results as Record<string, unknown>[];
    const spouses = spousesRes.results as Record<string, unknown>[];
    const links = linksRes.results as Record<string, unknown>[];
    const galleries = galleriesRes.results as Record<string, unknown>[];

    /*
     * Rebuild Main sheet
     */
    const spouseByPerson = new Map<string, Record<string, unknown>>();

    for (const spouse of spouses) {
      spouseByPerson.set(
        String(spouse.person_id ?? ''),
        spouse
      );
    }

    const mainRows = people.map((person) => {
      const personId = String(person.id ?? '');
      const spouse = spouseByPerson.get(personId);

      return {
        person: personId,
        person_full: String(person.full_name ?? ''),
        parent: String(person.parent_id ?? ''),
        tooltip: String(person.tooltip ?? ''),
        spouse: spouse ? String(spouse.id ?? '') : '',
        spouse_full: spouse
          ? String(spouse.full_name ?? '')
          : '',
      };
    });

    /*
     * Rebuild images sheet.
     *
     * Include images belonging to both people and spouses.
     */
    const imageRows: {
      person: string;
      image: string;
    }[] = [];

    for (const person of people) {
      const image = String(person.image_url ?? '');

      if (image) {
        imageRows.push({
          person: String(person.id ?? ''),
          image,
        });
      }
    }

    for (const spouse of spouses) {
      const image = String(spouse.image_url ?? '');

      if (image) {
        imageRows.push({
          person: String(spouse.id ?? ''),
          image,
        });
      }
    }

    /*
     * Rebuild links sheet
     */
    const linkRows = links.map((link) => ({
      person: String(link.person_id ?? ''),
      link: String(link.url ?? ''),
      tooltip: String(link.description ?? ''),
    }));

    /*
     * Rebuild gdrives sheet
     */
    const gdriveRows = galleries.map((gallery) => ({
      description: String(gallery.description ?? ''),
      link: String(gallery.gdrive_link ?? ''),
    }));

    /*
     * Create Excel workbook
     */
    const workbook = XLSX.utils.book_new();

    const mainSheet = XLSX.utils.json_to_sheet(mainRows, {
      header: [
        'person',
        'person_full',
        'parent',
        'tooltip',
        'spouse',
        'spouse_full',
      ],
    });

    const imageSheet = XLSX.utils.json_to_sheet(imageRows, {
      header: ['person', 'image'],
    });

    const linkSheet = XLSX.utils.json_to_sheet(linkRows, {
      header: ['person', 'link', 'tooltip'],
    });

    const gdriveSheet = XLSX.utils.json_to_sheet(gdriveRows, {
      header: ['description', 'link'],
    });

    XLSX.utils.book_append_sheet(workbook, mainSheet, 'Main');
    XLSX.utils.book_append_sheet(workbook, gdriveSheet, 'gdrives');
    XLSX.utils.book_append_sheet(workbook, imageSheet, 'images');
    XLSX.utils.book_append_sheet(workbook, linkSheet, 'links');

    /*
     * Generate .xlsx file
     */
    const excelData = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    });

    const excelBuffer = new Uint8Array(excelData as ArrayBuffer);

    /*
     * Store latest D1 backup in R2
     */
    const r2 = getR2();

    await r2.put('data_export.xlsx', excelBuffer, {
      httpMetadata: {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      customMetadata: {
        generatedAt: new Date().toISOString(),
        source: 'D1',
      },
    });

    /*
     * Return same workbook as a download
     */
    return new Response(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

        'Content-Disposition':
          'attachment; filename="data_export.xlsx"',

        'Cache-Control':
          'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('D1 Excel export error:', error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to export D1 to Excel',
      },
      {
        status: 500,
      }
    );
  }
}
