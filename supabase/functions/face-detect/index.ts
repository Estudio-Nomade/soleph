// Face detect — AWS Rekognition DetectFaces (boxes for lightbox)
// Deploy: supabase functions deploy face-detect --no-verify-jwt
// Public-ish: only published albums with search_by_face

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  RekognitionClient,
  DetectFacesCommand,
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
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const albumId = String(body.albumId || '');

    let bytes: Uint8Array | null = null;
    if (body.imageBase64) {
      const b64 = String(body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (body.imageUrl) {
      const imgRes = await fetch(String(body.imageUrl));
      if (!imgRes.ok) return json({ error: `No se pudo bajar la imagen (${imgRes.status})` }, 400);
      bytes = new Uint8Array(await imgRes.arrayBuffer());
    } else {
      return json({ error: 'Mandá imageUrl o imageBase64 + albumId' }, 400);
    }

    if (!albumId || !bytes?.length) return json({ error: 'albumId + imagen requeridos' }, 400);
    if (bytes.length > 5_500_000) return json({ error: 'Imagen demasiado grande' }, 400);

    const { data: album, error: aErr } = await admin
      .from('albums')
      .select('id, published, search_by_face')
      .eq('id', albumId)
      .maybeSingle();
    if (aErr) return json({ error: aErr.message }, 500);
    if (!album || !album.published || !album.search_by_face) {
      return json({ error: 'Álbum no disponible para búsqueda' }, 404);
    }

    const client = rekClient();
    const result = await client.send(
      new DetectFacesCommand({
        Image: { Bytes: bytes },
        Attributes: ['DEFAULT'],
      }),
    );

    const faces = (result.FaceDetails || [])
      .map((f) => {
        const b = f.BoundingBox;
        if (!b) return null;
        const left = Number(b.Left ?? 0);
        const top = Number(b.Top ?? 0);
        const width = Number(b.Width ?? 0);
        const height = Number(b.Height ?? 0);
        if (width <= 0 || height <= 0) return null;
        return {
          left: Math.max(0, Math.min(1, left)),
          top: Math.max(0, Math.min(1, top)),
          width: Math.max(0, Math.min(1, width)),
          height: Math.max(0, Math.min(1, height)),
          confidence: Number(f.Confidence ?? 0),
        };
      })
      .filter(Boolean)
      .filter((f) => (f?.confidence ?? 0) >= 70)
      .slice(0, 12);

    return json({
      ok: true,
      faces,
      photoId: body.photoId ? String(body.photoId) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('face-detect', message);
    return json({ error: message }, 500);
  }
});
