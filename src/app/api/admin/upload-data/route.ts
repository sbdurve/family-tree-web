import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { isAdmin } from '@/lib/auth';
import { getDB, getR2 } from '@/lib/db';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type ExcelRow = Record<string, unknown>;

function safeString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function readSheet(
  workbook: XLSX.WorkBook,
  sheetName: string
): ExcelRow[] {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json<ExcelRow>(sheet, {
    defval: '',
    raw: false,
  });
}

export async function POST(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file selected' },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json(
        { error: 'Only .xlsx files are allowed' },
        { status: 400 }
      );
    }

    const fileBuffer = await file.arrayBuffer();

    /*
     * Read and validate the workbook before changing R2 or D1.
     */
    const workbook = XLSX.read(new Uint8Array(fileBuffer), {
      type: 'array',
      cellDates: false,
    });

    const requiredSheets = [
      'Main',
      'images',
      'links',
      'gdrives',
    ];

    const missingSheets = requiredSheets.filter(
      (sheetName) => !workbook.Sheets[sheetName]
    );

    if (missingSheets.length > 0) {
      return NextResponse.json(
        {
          error:
            `Missing required sheets: ${missingSheets.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const mainRows = readSheet(workbook, 'Main');
    const imageRows = readSheet(workbook, 'images');
    const linkRows = readSheet(workbook, 'links');
    const gdriveRows = readSheet(workbook, 'gdrives');

    if (mainRows.length === 0) {
      return NextResponse.json(
        { error: 'The Main sheet contains no data' },
        { status: 400 }
      );
    }

    /*
     * Build the image lookup:
     *
     * images.person -> images.image
     */
    const imageMap = new Map<string, string>();

    for (const row of imageRows) {
      const personId = safeString(row.person);
      const imageUrl = safeString(row.image);

      if (personId && imageUrl) {
        imageMap.set(personId, imageUrl);
      }
    }

    const generationPlaceholders = new Set([
      'Generation_1',
      'Generation_2',
      'Generation_3',
      'Generation_4',
      'Generation_5',
      'Generation_6',
      'Generation_7',
      'Generation_8',
    ]);

    const db = getDB();

    /*
     * These initial statements reproduce the replacement behaviour
     * of scripts/import_from_excel.py.
     */
    const statements: D1PreparedStatement[] = [
      db.prepare('DELETE FROM links'),
      db.prepare('DELETE FROM galleries'),
      db.prepare('DELETE FROM spouses'),
      db.prepare('DELETE FROM people'),
    ];

    let peopleCount = 0;
    let spouseCount = 0;
    let linkCount = 0;
    let galleryCount = 0;

    /*
     * Import people and spouses from the Main sheet.
     */
    for (const row of mainRows) {
      const personId = safeString(row.person);
      const fullName = safeString(row.person_full);
      const parentId = safeString(row.parent);
      const tooltip = safeString(row.tooltip);
      const spouseId = safeString(row.spouse);
      const spouseFull = safeString(row.spouse_full);

      if (!personId) {
        continue;
      }

      const imageUrl = imageMap.get(personId) ?? '';

      const status = generationPlaceholders.has(personId)
        ? 'hidden'
        : 'approved';

      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO people
           (
             id,
             full_name,
             parent_id,
             tooltip,
             image_url,
             status
           )
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          personId,
          fullName || personId,
          parentId || null,
          tooltip,
          imageUrl,
          status
        )
      );

      peopleCount++;

      if (spouseId && spouseFull) {
        const spouseImageUrl = imageMap.get(spouseId) ?? '';

        statements.push(
          db.prepare(
            `INSERT OR IGNORE INTO spouses
             (
               id,
               full_name,
               person_id,
               image_url
             )
             VALUES (?, ?, ?, ?)`
          ).bind(
            spouseId,
            spouseFull,
            personId,
            spouseImageUrl
          )
        );

        spouseCount++;
      }
    }

    /*
     * Import links from the links sheet.
     *
     * links.person  -> person_id
     * links.link    -> url
     * links.tooltip -> description and display_html
     */
    for (const row of linkRows) {
      const personId = safeString(row.person);
      const url = safeString(row.link);
      const description = safeString(row.tooltip);

      if (!personId || !url) {
        continue;
      }

      statements.push(
        db.prepare(
          `INSERT INTO links
           (
             person_id,
             url,
             description,
             display_html
           )
           VALUES (?, ?, ?, ?)`
        ).bind(
          personId,
          url,
          description,
          description
        )
      );

      linkCount++;
    }

    /*
     * Import galleries from the gdrives sheet.
     *
     * gdrives.description -> description
     * gdrives.link        -> gdrive_link
     */
    for (let index = 0; index < gdriveRows.length; index++) {
      const row = gdriveRows[index];

      const description = safeString(row.description);
      const link = safeString(row.link);

      if (!description || !link) {
        continue;
      }

      statements.push(
        db.prepare(
          `INSERT INTO galleries
           (
             description,
             gdrive_link,
             display_order
           )
           VALUES (?, ?, ?)`
        ).bind(
          description,
          link,
          index
        )
      );

      galleryCount++;
    }

    /*
     * Run all D1 replacements as one batch.
     */
    await db.batch(statements);

    /*
     * Save the successfully parsed workbook in R2 as data.xlsx.
     */
    const r2 = getR2();

    await r2.put('data.xlsx', fileBuffer, {
      httpMetadata: {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'data.xlsx uploaded to R2 and imported into D1',
      imported: {
        people: peopleCount,
        spouses: spouseCount,
        links: linkCount,
        galleries: galleryCount,
      },
    });
  } catch (error) {
    console.error('Upload and import error:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to upload and import data.xlsx',
      },
      { status: 500 }
    );
  }
}
