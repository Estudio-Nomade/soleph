# Conectar AWS Rekognition a Soleph

Guía paso a paso. **Las keys de AWS nunca van al browser ni a Vercel `PUBLIC_*`.**
Van en secretos de **Supabase Edge Functions** (o un server tuyo).

Stack:

```
Admin sube foto → Supabase Storage
                → Edge Function face-index → Rekognition IndexFaces
Comprador selfie → Edge Function face-search → SearchFacesByImage
                → photo_ids → grilla / carrito
```

Collection por evento: `soleph-{albumId}`  
ExternalImageId = `photos.id` (UUID)

Budget alarm: **USD 5/mes** (paso 6).

---

## Qué necesito de vos (checklist)

Cuando termines los pasos 1–5, en el repo (solo `.env` local, **no git**):

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
REKOGNITION_COLLECTION_PREFIX=soleph-
AWS_BUDGET_LIMIT_USD=5
```

Y en Supabase → Project Settings → Edge Functions → Secrets, los mismos nombres.

Con eso yo cableo index al upload + `/tienda/buscar` al endpoint real.

También necesito que me confirmes:

- [ ] Cuenta AWS creada y tarjeta OK
- [ ] Región elegida (recomiendo `us-east-1` o `sa-east-1` São Paulo)
- [ ] IAM user `soleph-rekognition` creado
- [ ] Access key copiada (solo se ve una vez)
- [ ] Budget $5 + alerta email listos
- [ ] Secrets pegados en Supabase Edge Functions

---

## Paso 1 — Cuenta AWS

1. Entrá a https://aws.amazon.com/ y creá / iniciá sesión.
2. Aceptá el free tier / créditos (después de eso pagás **consumo**; Sole ≈ centavos–pocos USD/mes).
3. Elegí región de trabajo. Anotála:
   - `us-east-1` (N. Virginia) — barata, docs estándar
   - `sa-east-1` (São Paulo) — más cerca LATAM, a veces un toque más cara

---

## Paso 2 — IAM: usuario solo para Rekognition

No uses la root key.

1. IAM → Users → Create user  
   Nombre: `soleph-rekognition`
2. Attach policies directly → Create policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SolephRekognition",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateCollection",
        "rekognition:DeleteCollection",
        "rekognition:DescribeCollection",
        "rekognition:ListCollections",
        "rekognition:IndexFaces",
        "rekognition:DeleteFaces",
        "rekognition:SearchFacesByImage",
        "rekognition:ListFaces",
        "rekognition:DetectFaces"
      ],
      "Resource": "*"
    }
  ]
}
```

Nombre policy: `SolephRekognitionMinimal`

3. Attach esa policy al user.
4. Security credentials → Create access key → **Application running outside AWS**
5. Guardá en un password manager:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY` (solo se muestra una vez)

---

## Paso 3 — (Opcional) Probar desde tu PC

```bash
# Kali: si no tenés aws cli
# (sin sudo global: usá el instalador oficial o pipx)

export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1

aws sts get-caller-identity
aws rekognition create-collection --collection-id soleph-test
aws rekognition delete-collection --collection-id soleph-test
```

Si eso anda, las keys sirven.

---

## Paso 4 — Secrets en el proyecto Soleph

### Local (`.env` — ya está en .gitignore)

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
REKOGNITION_COLLECTION_PREFIX=soleph-
AWS_BUDGET_LIMIT_USD=5
# service role ya debería estar de cuando creamos el proyecto
# SUPABASE_SERVICE_ROLE_KEY=...
```

### Supabase Dashboard

Project `xfjukxgkqgwmghteooht` → **Edge Functions → Secrets** (o Project Settings → Edge Functions):

| Name | Value |
|------|--------|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | `...` |
| `REKOGNITION_COLLECTION_PREFIX` | `soleph-` |
| `SUPABASE_SERVICE_ROLE_KEY` | (la del proyecto, si no está auto) |
| `SUPABASE_URL` | `https://xfjukxgkqgwmghteooht.supabase.co` |

Nunca `PUBLIC_AWS_*`.

---

## Paso 5 — Deploy Edge Functions

En el repo ya van (o van a ir) en `supabase/functions/`:

- `face-index` — body: `{ albumId, photoId, imageUrl }` o bytes
- `face-search` — body: selfie + `albumId` → `{ photoIds }`

Desde la máquina (con CLI logueada):

```bash
cd ~/Documentos/Estudio\ Nomade/Soleph
supabase link --project-ref xfjukxgkqgwmghteooht
supabase secrets set \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=... \
  REKOGNITION_COLLECTION_PREFIX=soleph-

supabase functions deploy face-index
supabase functions deploy face-search
```

---

## Paso 6 — Budget alarm USD 5

1. AWS Console → **Billing** → **Budgets** → Create budget  
2. Cost budget → Monthly → **5 USD**  
3. Alert threshold: 50% (2.5), 80% (4), 100% (5)  
4. Email: el tuyo / Sole  
5. Nombre: `soleph-rekognition-5usd`

Opcional extra: AWS Cost Anomaly Detection.

Con el uso de Sole (eventos locales) casi nunca debería disparar; es red de seguridad.

---

## Paso 7 — Flujo de producto (cuando esté cableado)

| Momento | Acción |
|---------|--------|
| Admin crea evento | `CreateCollection` `soleph-{albumId}` (lazy al primer upload) |
| Admin sube foto | Edge `face-index` → `IndexFaces` (Bytes o S3 si más adelante) · ExternalImageId = photo UUID |
| Admin borra foto | `DeleteFaces` + borrar row |
| `/tienda/buscar` | Edge `face-search` → `SearchFacesByImage` · FaceMatchThreshold ~80–90 · devolver photo ids |
| Archivar evento | opcional `DeleteCollection` |

Tabla útil en SB (ya existe campo en photos):

- `photos.rekognition_face_ids text[]` — face ids de AWS por si hay que borrar

---

## Costes esperados (post free tier)

- Group 1 (`IndexFaces` / `SearchFacesByImage`): ~**USD 0,001 / imagen**
- Storage face metadata: ~**USD 0,00001 / cara / mes**
- 1 evento 800 fotos + 150 selfies ≈ **~1 USD**
- Alarm a **5 USD/mes** te avisa antes de sustos

---

## Seguridad

- IAM mínimo (solo Rekognition, no S3/EC2 admin)
- Rotar access keys si se filtran
- Edge Function valida `albumId` publicado en search
- No loguear selfies ni access keys
- Selfie no hace falta persistirlo: match en request y listo

---

## Qué hago yo cuando me pases las keys

1. Confirmar `aws sts get-caller-identity` / test collection  
2. Terminar/deploy `face-index` + `face-search`  
3. Cambiar admin upload → llamar index (además o en lugar de face-api local)  
4. Cambiar `/tienda/buscar` live path → `face-search`  
5. Probar con 10 fotos + selfie  
6. Dejar face-api local como fallback opcional o apagarlo  

---

## Orden tuyo ahora (resumen corto)

1. Crear/login AWS  
2. IAM user + policy + access key  
3. Anotar región  
4. Budget $5 + email  
5. Pegar secrets en `.env` local **y** Supabase Edge secrets  
6. Decime “keys listas” (sin pegar el secret en el chat si podés; con que estén en `.env` alcanzo)

Si querés, el siguiente mensaje puede ser solo: región + “keys en .env” y sigo yo con el código/deploy.
