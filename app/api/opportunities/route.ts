import { NextResponse } from 'next/server';
import { readOpportunities, removeOpportunity } from '@/store/opportunity-store';

/** GET /api/opportunities — dashboard polls this every 30 s */
export async function GET() {
  try {
    const opportunities = await readOpportunities();
    return NextResponse.json({ success: true, opportunities });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/** DELETE /api/opportunities?id=xxx — dashboard calls this on approve/ignore */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }
    await removeOpportunity(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
