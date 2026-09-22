// Face search — AWS Rekognition SearchFacesByImage
// Deploy: supabase functions deploy face-search
// Public-ish: only published albums with search_by_face

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  RekognitionClient,
  SearchFacesByImageCommand,
} from 'https://esm.sh/@aws-sdk/client-rekognition@3.758.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function collectionId(albumId: string) {
  const prefix = Deno.env.get('REKOGNITION_COLLECTION_PREFIX') || 'soleph-';
  return `${prefix}${albumId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 255);
}

function rekClient() {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1';
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Faltan AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY en secrets');
  }
  return new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PUBLIC_SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('PUBLIC_SUPABASE_ANON_KEY') || serviceKey;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const albumId = String(body.albumId || '');
    const threshold = Number(body.threshold ?? 85); // Rekognition similarity 0-100
    const maxFaces = Math.min(Math.max(1, Number(body.maxFaces ?? 20)), 100);

    let bytes: Uint8Array | null = null;
    if (body.imageBase64) {
      const b64 = String(body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (body.imageUrl) {
      const imgRes = await fetch(String(body.imageUrl));
      if (!imgRes.ok) return json({ error: `No se pudo bajar selfie (${imgRes.status})` }, 400);
      bytes = new Uint8Array(await imgRes.arrayBuffer());
    } else {
      return json({ error: 'Mandá imageBase64 (selfie) + albumId' }, 400);
    }

    if (!albumId || !bytes?.length) return json({ error: 'albumId + selfie requeridos' }, 400);
    if (bytes.length > 5_500_000) return json({ error: 'Selfie demasiado grande' }, 400);

    // only published + face-enabled albums
    const { data: album, error: aErr } = await admin
      .from('albums')
      .select('id, name, published, search_by_face, photo_price_ars, date_label, cover_path')
      .eq('id', albumId)
      .maybeSingle();
    if (aErr) return json({ error: aErr.message }, 500);
    if (!album || !album.published || !album.search_by_face) {
      return json({ error: 'Álbum no disponible para búsqueda' }, 404);
    }

    const client = rekClient();
    const coll = collectionId(albumId);

    let result;
    try {
      result = await client.send(
        new SearchFacesByImageCommand({
          CollectionId: coll,
          Image: { Bytes: bytes },
          FaceMatchThreshold: threshold,
          MaxFaces: maxFaces,
          QualityFilter: 'AUTO',
        }),
      );
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name || '';
      if (name === 'ResourceNotFoundException') {
        return json({ photoIds: [], matches: [], message: 'Evento sin caras indexadas todavía' });
      }
      throw err;
    }

    const matchesRaw = result.FaceMatches || [];
    // ExternalImageId we set = photo UUID
    const scored = new Map<string, number>();
    for (const m of matchesRaw) {
      const pid = m.Face?.ExternalImageId;
      const sim = m.Similarity ?? 0;
      if (!pid) continue;
      const prev = scored.get(pid) || 0;
      if (sim > prev) scored.set(pid, sim);
    }

    const photoIds = [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // hydrate previews
    let photos: { id: string; preview_path: string; sort_order: number; code: string | null }[] = [];
    if (photoIds.length) {
      const { data: ph } = await admin
        .from('photos')
        .select('id, preview_path, sort_order, code')
        .eq('album_id', albumId)
        .in('id', photoIds);
      photos = ph || [];
    }

    const byId = new Map(photos.map((p) => [p.id, p]));
    const matches = photoIds
      .map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        return {
          photoId: id,
          code: p.code || id.replace(/-/g, '').slice(0, 8).toUpperCase(),
          similarity: scored.get(id),
          previewPath: p.preview_path,
          sortOrder: p.sort_order,
        };
      })
      .filter(Boolean);

    return json({
      ok: true,
      album: {
        id: album.id,
        name: album.name,
        date_label: album.date_label,
        photo_price_ars: album.photo_price_ars,
      },
      photoIds,
      matches,
      searchedFaceConfidence: result.SearchedFaceConfidence,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('face-search', message);
    return json({ error: message }, 500);
  }
});
