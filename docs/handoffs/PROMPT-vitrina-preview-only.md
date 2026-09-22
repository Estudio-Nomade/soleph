# Handoff — Soleph modo vitrina (preview only)

Para otro agente / follow-up. Repo: `~/Documentos/Estudio Nomade/Soleph` · branch típica `agent/vitrina-preview-only` · GH `martiyaquinta/soleph` (privado).

## Qué se hizo (producto)

La tienda **no hospeda el JPG de cámara**. Al subir un evento:

1. Se genera **un solo** JPEG con marca de agua (browser, `makeWatermarkedPreview`).
2. Default: **maxEdge 1024 · quality 0.62** (`PREVIEW_PRESETS.default` en `src/lib/watermark.js`).
3. Solo se sube a bucket **`album-previews`**.
4. **`original_path = null`** — no se sube a `album-originals`.
5. Sole entrega el original **por fuera** (Drive/WA) cuando confirma el pago.

Flag: `STOREFRONT_PREVIEWS_ONLY = true` en `src/pages/admin/evento/editar.astro`.

## Archivos clave

| Path | Rol |
|------|-----|
| `src/lib/watermark.js` | Presets + bake WM |
| `src/pages/admin/evento/editar.astro` | Upload sin originals + copy admin |
| `src/pages/lab/vitrina.astro` | Lab comparar presets (solo `npm run dev`) |
| `src/pages/lab/demo-vitrina.astro` | Demo álbum 1024 |
| `src/pages/lab/demo-dual.astro` | Demo 640 grilla + 1024 lightbox |
| `src/pages/lab/demo-mini.astro` | Demo grilla liviana (legacy lab) |

## Auth GH

Repo privado. Si `Repository not found`:

```bash
gh auth switch --user martiyaquinta && gh auth setup-git
```

## Verificar

```bash
cd ~/Documentos/Estudio\ Nomade/Soleph
npm run build
npm run dev -- --host 127.0.0.1 --port 4321
# http://127.0.0.1:4321/lab/demo-vitrina
# http://127.0.0.1:4321/lab/vitrina
```

## Follow-ups posibles (NO hechos)

1. **Eventos viejos** ya en SB con originals: job opcional borrar `album-originals` + null `original_path` (cuidado face re-bake).
2. **Dual prod** (thumb_path + preview_path) si el tráfico de grilla duele — hoy un solo 1024.
3. Face index: hoy indexa desde preview URL; con 1024 suele alcanzar. Si match baja, subir un poco maxEdge o indexar antes de comprimir de más.
4. “Actualizar marcas de agua” solo sirve si hay `original_path` (eventos viejos). Nuevos: re-subir.
5. No commitear `.ops-local/`, PDFs de costos en root, ni secrets.

## Criterio de aceptación

- [ ] Subir evento en admin: filas en `photos` con `preview_path` y `original_path` null/vacío.
- [ ] Storage: objetos solo en `album-previews` (no nuevos en `album-originals`).
- [ ] Tienda `/tienda/evento` muestra grilla + lightbox con WM.
- [ ] `npm run build` OK.
- [ ] Copy admin menciona modo vitrina / entrega por fuera.

## No hacer

- No hardcodear keys.
- No `git add .` (evitar PDFs / ops-local).
- No force-push main.
- No desplegar dual a prod sin pedido explícito.
