// Storage delete — SeaweedFS S3
// Deploy: supabase functions deploy storage-delete --no-verify-jwt
// Secrets: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { S3Client, DeleteObjectsCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.758.0';

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

const KIND_PREFIX: Record<string, string> = {
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
  'album-previews': 'previews',
  'album-originals': 'originals',
  'album-covers': 'covers',
};

function cleanPath(path: string) {
  return String(path || '').replace(/^\/+/, '').replace(/\.\./g, '');
}

function objectKey(kind: string, path: string) {
  const prefix = KIND_PREFIX[kind];
  if (!prefix) throw new Error(`kind inválido: ${kind}`);
  const clean = cleanPath(path);
  if (!clean) throw new Error('path vacío');
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(clean)) throw new Error('path inválido');
  return `${prefix}/${clean}`;
}

function s3() {
  const endpoint = Deno.env.get('S3_ENDPOINT');
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY');
  const region = Deno.env.get('S3_REGION') || 'us-east-1';
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Faltan S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
  }
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function requireAdmin(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PUBLIC_SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('PUBLIC_SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !serviceKey) throw new Error('Falta SUPABASE_URL / SERVICE_ROLE');

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json({ error: 'No auth' }, 401) };
  if (anonKey && token === anonKey) return { error: json({ error: 'Se requiere sesion admin' }, 401) };

  const admin = createClient(supabaseUrl, serviceKey);
  if (token === serviceKey) return { admin, userId: 'service' };

  const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) return { error: json({ error: 'No auth' }, 401) };
  const { data: profile } = await admin.from('profiles').select('id, role').eq('id', userData.user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return { error: json({ error: 'Sin permiso' }, 403) };
  return { admin, userId: profile.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const gate = await requireAdmin(req);
    if ('error' in gate && gate.error) return gate.error;

    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return json({ error: 'items vacío' }, 400);

    const keys = items.map((item: { kind?: string; path?: string }) =>
      objectKey(String(item.kind || ''), String(item.path || '')),
    );

    const bucket = Deno.env.get('S3_BUCKET') || 'storage';
    const client = s3();
    const chunkSize = 1000;
    let deleted = 0;

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      deleted += chunk.length;
    }

    return json({ ok: true, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('storage-delete', msg);
    return json({ error: msg }, 500);
  }
});
