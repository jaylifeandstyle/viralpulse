import { NextResponse } from 'next/server';
import { readOpportunities, updateOpportunity } from '@/store/opportunity-store';
import { enrichMediaForTopic } from '@/galaxies/galaxy.07/shared/enrich-media';

/** POST /api/opportunities/enrich-media — resolve images for an existing opportunity */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    const opps = await readOpportunities();
    const opp = opps.find((o) => o.id === id);
    if (!opp) {
      return NextResponse.json({ success: false, error: 'Opportunity not found' }, { status: 404 });
    }

    const existing = opp.imageUrls?.filter(Boolean) ?? [];
    if (existing.length > 0 || opp.videoUrl) {
      return NextResponse.json({
        success: true,
        imageUrls: existing.length ? existing : opp.imageUrl ? [opp.imageUrl] : [],
        videoUrl: opp.videoUrl,
        cached: true,
      });
    }

    const media = await enrichMediaForTopic(opp.topic, opp.imageSearchQuery);
    if (!media.imageUrls.length && !media.videoUrl) {
      return NextResponse.json({
        success: false,
        error: 'No suitable images found for this topic',
      });
    }

    const patch = {
      imageUrls: media.imageUrls,
      imageUrl: media.imageUrls[0],
      videoUrl: media.videoUrl,
    };
    await updateOpportunity(id, patch);

    return NextResponse.json({
      success: true,
      imageUrls: media.imageUrls,
      videoUrl: media.videoUrl,
      cached: false,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
