import { NextResponse } from 'next/server';
import { getR2 } from '@/lib/db';

export const runtime = 'edge';

export async function POST(request: Request) {
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

    const r2 = getR2();

    const fileBuffer = await file.arrayBuffer();

    await r2.put('data.xlsx', fileBuffer, {
      httpMetadata: {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      customMetadata: {
        originalName: file.name,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'data.xlsx uploaded successfully',
    });
  } catch (error) {
    console.error('Upload data.xlsx error:', error);

    return NextResponse.json(
      { error: 'Failed to upload data.xlsx' },
      { status: 500 }
    );
  }
}
