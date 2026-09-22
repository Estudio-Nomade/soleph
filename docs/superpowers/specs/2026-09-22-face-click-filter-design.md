# Face click → filtrar álbum — Design

**Fecha:** 2026-09-22  
**Estado:** aprobado (mockup + feedback)

## Problema

En un álbum de evento, el comprador abre una foto y quiere ver **todas las fotos de una persona** tocando su cara (estilo Cintia Zapico / FullFoto), sin subir un selfie desde `/tienda/buscar`.

## Decisiones

| Tema | Decisión |
|------|----------|
| Destino | Mismo álbum (`/tienda/evento`), no `/tienda/buscar` |
| UI de selección | Al abrir lightbox: recuadros en todas las caras detectadas |
| Resultado | **Ocultar el resto**: solo matches en un grid junto (sin dim/scroll del álbum completo) |
| URL | Compartible: `?id={album}&cara={token}` |
| Storage boxes | **No** guardar en Supabase. Detect on-open (DetectFaces) |
| Búsqueda | Crop de la cara → `SearchFacesByImage` (reusa `face-search`) |
| Álbumes viejos | Funciona sin reindex extra (collection ya indexada) |
| Scope | Solo álbumes live con `published && search_by_face` |

## Flujo

1. Cliente abre foto en lightbox (evento con face on).
2. Front llama Edge `face-detect` con URL del preview → boxes (ratios 0–1).
3. Overlay navy/blanco sobre cada cara; hint “Tocá un recuadro…”.
4. Click cara → crop en canvas → `face-search` con ese crop → `photoIds`.
5. Cierra lightbox; grid del álbum muestra **solo** matches (orden por similarity).
6. Chip: “N fotos de esta persona · Ver todas”.
7. URL: `?id=…&cara=…` (token decodificable, ver abajo).
8. Deep-link: al cargar con `cara`, re-ejecuta crop+search y pinta el filtro.

## Token `cara`

Sin tabla nueva. Token = base64url(JSON compacto):

```json
{ "p": "<photoId>", "b": { "l": 0.2, "t": 0.1, "w": 0.15, "h": 0.2 } }
```

- `p` = foto de origen  
- `b` = box ratios AWS (Left/Top/Width/Height)

Al abrir el link: se carga el preview de `p`, se recorta `b`, se busca de nuevo. Si la foto no existe o falla detect/search → mensaje corto y álbum completo.

## API

### `POST face-detect` (nueva Edge Function)

- Público condicionado: álbum `published && search_by_face`
- Body: `{ albumId, imageUrl | imageBase64, photoId? }`
- AWS: `DetectFaces` (Attributes DEFAULT, MaxFaces ~12)
- Response: `{ ok, faces: [{ left, top, width, height, confidence }] }` (ratios 0–1)
- Sin caras: `{ ok, faces: [] }`

### `face-search` (existente)

- Sin cambio de contrato obligatorio
- Subir `maxFaces` efectivo en cliente a **100** (cap AWS-safe) cuando se busca por click/cara, para no truncar álbumes grandes

## Front

| Pieza | Rol |
|-------|-----|
| `src/lib/face.js` | `detectPhotoFaces`, `encodeCaraToken` / `decodeCaraToken`, crop helper, search con limit alto |
| `src/components/Lightbox.astro` | capa de faces + API `open(..., { faces })` |
| `src/pages/tienda/evento.astro` | wire face mode, filtro grid, chip, `?cara=` |
| `src/styles/global.css` | `.lb-face-hit`, chip filtro |

No face boxes en portafolio seed (`/tienda/cordillera`) ni álbumes sin `search_by_face`.

## Errores / vacíos

- Detect falla o 0 caras: lightbox normal, sin boxes (sin error ruidoso).
- Search 0 matches: toast/nota “No encontramos más fotos de esta persona” + grid sin filtro o vacío con “Ver todas”.
- Loading: “Detectando caras…” / “Buscando fotos…”.

## Fuera de scope

- Guardar boxes en Postgres  
- SearchFaces por FaceId  
- Portafolio estático  
- Cambiar flujo selfie de `/tienda/buscar`

## Costo

- 1× DetectFaces por open de foto (con face on)  
- 1× SearchFacesByImage por click de cara (y por deep-link)  
- ~USD 0,001 c/u — mismo orden que el path actual
