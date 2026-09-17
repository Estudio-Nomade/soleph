// Face index — AWS Rekognition
// Deploy: supabase functions deploy face-index
// Secrets: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, REKOGNITION_COLLECTION_PREFIX

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
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

async function ensureCollection(client: RekognitionClient, id: string) {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: id }));
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name || '';
    if (name !== 'ResourceAlreadyExistsException') throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PUBLIC_SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('PUBLIC_SUPABASE_ANON_KEY') || '';
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const admin = createClient(supabaseUrl, serviceKey);

    // Allow admin user JWT or service-role key. Reject bare anon.
    if (!token) return json({ error: 'No auth' }, 401);

    if (token !== serviceKey) {
      if (anonKey && token === anonKey) {
        return json({ error: 'Se requiere sesion admin' }, 401);
      }
      const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser(token);
      if (userErr || !userData.user) return json({ error: 'No auth' }, 401);
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', userData.user.id)
        .maybeSingle();
      if (profile?.role !== 'admin') return json({ error: 'Solo admin' }, 403);
    }

    const body = await req.json();
    const albumId = String(body.albumId || '');
    const photoId = String(body.photoId || '');
    const imageUrl = body.imageUrl ? String(body.imageUrl) : '';
    let bytes: Uint8Array | null = null;

    if (body.imageBase64) {
      const b64 = String(body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return json({ error: `No se pudo bajar imagen (${imgRes.status})` }, 400);
      bytes = new Uint8Array(await imgRes.arrayBuffer());
    } else {
      return json({ error: 'Manda imageUrl o imageBase64 + albumId + photoId' }, 400);
    }

    if (!albumId || !photoId || !bytes?.length) {
      return json({ error: 'albumId, photoId e imagen requeridos' }, 400);
    }
    if (bytes.length > 5_500_000) {
      return json({ error: 'Imagen demasiado grande para IndexFaces (max ~5MB)' }, 400);
    }

    const client = rekClient();
    const coll = collectionId(albumId);
    await ensureCollection(client, coll);

    const out = await client.send(
      new IndexFacesCommand({
        CollectionId: coll,
        Image: { Bytes: bytes },
        ExternalImageId: photoId.replace(/[^a-zA-Z0-9_.\-:]/g, '-').slice(0, 255),
        DetectionAttributes: ['DEFAULT'],
        MaxFaces: 10,
        QualityFilter: 'AUTO',
      }),
    );

    const faceIds = (out.FaceRecords || [])
      .map((fr) => fr.Face?.FaceId)
      .filter((id): id is string => Boolean(id));

    await admin
      .from('photos')
      .update({ rekognition_face_ids: faceIds })
      .eq('id', photoId)
      .eq('album_id', albumId);

    return json({
      ok: true,
      collectionId: coll,
      faceIds,
      indexed: faceIds.length,
      unindexed: (out.UnindexedFaces || []).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('face-index', message);
    return json({ error: message }, 500);
  }
});
