# CompreFace + Soleph (GitHub · Vercel · Supabase)

## ¿Anda bien con este stack?

**Sí, con un cuarto componente.**

| Pieza | Qué hace | ¿Corre CompreFace? |
|-------|----------|--------------------|
| GitHub | código Soleph | No |
| Vercel | front Astro (static) | **No** — no hay Docker ni procesos largos |
| Supabase | Auth, DB, Storage de fotos | No (solo guarda metadata / paths) |
| **VPS / box con Docker** | CompreFace 24/7 | **Sí — acá vive** |

Sin ese server (aunque sea barato o free ARM), no hay face search en prod. El front en Vercel **nunca** habla directo con CompreFace (API key se filtraría): llama a un **proxy** (Supabase Edge Function o ruta server) que sí tiene la key.

Repo upstream: https://github.com/exadel-inc/CompreFace  
Docs API: https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md  
Release listo (no hace falta clonar para prod): https://github.com/exadel-inc/CompreFace/releases

---

## Modelo de datos Soleph ↔ CompreFace

CompreFace piensa en **subjects** (etiquetas) + **examples** (caras).

Para “selfie → fotos mías del evento”:

- **1 Face Recognition Service** (una API key) para toda la tienda, o 1 por álbum si crece mucho
- **subject** = `photo_id` (UUID de `photos.id` en Supabase)
- Al indexar una foto de evento: detectar caras y subir **cada cara** como example del subject `photo_id`
- Al buscar: `POST /recognize` con el selfie → devuelve subjects (`photo_id`) + similarity → el front filtra la grilla

Prefijo opcional: subject = `{albumId}:{photoId}` para no mezclar álbumes en una sola collection enorme.

Threshold típico de similarity: empezar en **0.8–0.9** y ajustar con pruebas reales.

---

## Pasos (orden)

### 0. Requisitos del host CompreFace

- Docker + Docker Compose
- CPU x86_64 **con AVX** (`lscpu | grep avx`)
- RAM: **mín 4 GB** cómodo (2 GB justo; 8 GB mejor si hay eventos grandes)
- Disco: 10+ GB libres
- Puerto **8000** (o el que expongas) alcanzable por el proxy (no hace falta público al mundo si usás tunnel/VPN; en prod suele ser HTTPS con firewall solo a IPs de Supabase/Vercel si se puede)

### 1. Instalar CompreFace en el VPS (recomendado: release, no git clone)

Clonar el repo es para **desarrollar** CompreFace. Para **usarlo**:

```bash
# en el VPS
mkdir -p ~/compreface && cd ~/compreface
# bajar el zip de la última release (docker-compose.yml + .env)
# https://github.com/exadel-inc/CompreFace/releases
unzip compreface_*.zip
docker compose up -d
# esperar 30–60s
docker compose ps   # 5 servicios Up: core, api, admin, ui, postgres
```

UI: `http://IP:8000/login`

Single-container (más simple, menos flexible):

```bash
docker run -d --name=CompreFace --restart=always \
  -v compreface-db:/var/lib/postgresql/data \
  -p 8000:80 \
  exadel/compreface
```

### 2. Configurar app + Recognition Service

1. Abrir UI → sign up (admin local de CompreFace)
2. Create **Application** (ej. `soleph`)
3. Create service tipo **Face Recognition** (ej. `event-photos`)
4. Copiar la **API key** del service → va a secretos del proxy, **nunca** al front ni a git

### 3. Hardening mínimo

- Cambiar password del admin UI
- No exponer `:8000` abierto al mundo sin TLS
- Ideal: Nginx/Caddy con HTTPS + auth o IP allowlist
- Variable `save_images_to_db=false` si no querés duplicar imágenes en Postgres de CompreFace (las tenés en Supabase Storage)
- Backup del volume `postgres-data` de CompreFace (son los embeddings)

### 4. Secrets en Soleph / Supabase

En `.env` local y en secretos de Edge Functions (no `PUBLIC_*`):

```bash
COMPREFACE_URL=https://face.tu-dominio.com
COMPREFACE_API_KEY=xxxxxxxx
# opcional
COMPREFACE_MIN_SIMILARITY=0.85
```

### 5. Index al subir foto (admin)

Cuando el admin termina el upload a Supabase Storage + row en `photos`:

```http
POST {COMPREFACE_URL}/api/v1/recognition/faces?subject={photo_id}
Header: x-api-key: {COMPREFACE_API_KEY}
Body: multipart file= (preview o crop de cara)
```

Si la foto tiene **varias personas**:

1. `POST /api/v1/detection/detect` (Detection service) → boxes
2. Crop de cada cara
3. `POST .../faces?subject={photo_id}` por cada crop  

(Así un subject=foto junta todas las caras de esa toma.)

Guardar en Supabase por si hace falta reindex:

- `photos.face_indexed_at`
- o `photos.compreface_image_ids text[]`

### 6. Buscar mis fotos (storefront)

Front (`/tienda/buscar`) ya tiene UX. El submit debe ir a **nuestro** endpoint, no a CompreFace:

```http
POST /api/face-search
Body: { albumId, selfie: File|base64 }
```

El proxy (Edge Function):

1. Valida `albumId` publicado
2. `POST {COMPREFACE}/api/v1/recognition/recognize?limit=50&prediction_count=1`
   - header `x-api-key`
   - body multipart selfie
3. Filtra subjects que pertenezcan a ese `albumId` (por prefijo o join a `photos`)
4. Filtra `similarity >= MIN`
5. Devuelve `{ photoIds: string[] }`
6. Front muestra solo esas fotos → carrito igual

**No** mandar la API key al browser.

### 7. Dónde poner el proxy con Vercel static

Astro static en Vercel **no** tiene API routes server-side a menos que pases a hybrid/server.

Opciones sanas:

| Opción | Pros |
|--------|------|
| **A. Supabase Edge Function** `face-search` | Mismo proyecto, secretos SB, encaja con el stack |
| B. Vercel serverless aparte / Astro `output: 'server'` solo para API | Más acoplado al front |
| C. Tiny service en el mismo VPS que CompreFace | Simple, un solo box |

Recomendado Soleph: **A** (search) + job de index desde admin vía misma function o queue.

### 8. Flujo end-to-end de prueba

1. CompreFace up + service + API key
2. Schema Supabase corrido + admin Sole logueado
3. Crear evento de prueba, subir 20 fotos con caras conocidas
4. Verificar subjects en UI Test de CompreFace
5. Edge Function search con selfie de una persona que está en 3 fotos → 3 ids
6. Misma persona ausente → 0 o low similarity
7. Recién ahí cablear `/tienda/buscar`

### 9. Ops / capacidad (recordatorio)

- Software: $0
- VPS ~4 GB: holgado para eventos Sole (miles de index + searches/mes)
- Free tier muy chico: puede OOM al indexar lotes grandes → subir de a N fotos
- AVX obligatorio en builds default

### 10. Qué no hacer

- Meter CompreFace en el repo de Soleph como submodule “para Vercel”
- Llamar a CompreFace desde el browser con la API key
- Una sola collection infinita sin filtrar por `albumId` (ruido + lentitud)
- Indexar RAW de 20 MP; usar preview ~1000–1600 px
- Exponer Postgres de CompreFace a internet

---

## Mapa mental

```
Sole (admin) → Vercel /admin → Supabase Storage + photos
                    ↓
            Edge Function index → CompreFace (VPS Docker)
                    ↓
Comprador → /tienda/buscar → Edge Function search → CompreFace
                    ↓
              photo_ids → grilla → carrito → WA
```

## Estado en Soleph hoy

- Admin upload + watermark: listo
- UX buscar: lista
- CompreFace + Edge Function + index hook: **pendiente** (esta doc es el plan)

Cuando digas “arrancá face”, orden de código:

1. Edge Function `face-search` + `face-index`
2. Hook post-upload en admin
3. Cablear `tienda/buscar.astro` al endpoint
4. (Opcional) 1 Recognition Service por álbum si un service global se pone lento
