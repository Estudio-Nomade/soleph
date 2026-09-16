# AGENTS.md — Soleph

## Contexto del proyecto

Portfolio + tienda de fotos para **Sole Yaquinta** (Tandil). Look Adobe Portfolio (tema marina/marta: fondo blanco, navy `#012B55`, header fijo, serif en títulos). Dinámica de compra inspirada en FullFoto / cintiazapicofotografia.com.ar (álbumes de evento, packs por cantidad, carrito, MP/transferencia).

Contenido real migrado de `soleyaquinta.myportfolio.com`. No inventar proyectos ni bio.

## Idioma

Español argentino, concreto, sin relleno ni tono corporate.

## Reglas de producto

- Marca visual: navy `#012B55`, hover `#546E87`, blanco, logo en `public/images/logo.png`.
- No vaciar ni reemplazar `public/images` sin pedido explícito.
- Tienda: precios base y tiers viven en `src/data/site.json` → `shop.albums[]`.
- Checkout demo puede guardar pedido en localStorage; no hardcodear keys de Mercado Pago en el front.
- Reconocimiento facial: UX sí, motor real solo cuando haya API.
- Textos UI: humanos, cortos. Evitar “delve / landscape / seamless / unlock”.

## Configuración

- `.env` → secretos (MP access token, endpoint de órdenes) cuando existan.
- `src/data/site.json` → contenido y precios de negocio editables sin redeploy de lógica.
- `.env.example` trackeable; `.env` nunca.

## Git

- Conventional Commits.
- Branches `agent/corta-desc`.
- Nunca `git add .` / force-push a main / `--no-verify`.
- Stagear paths concretos.
- `Co-Authored-By` si un modelo co-escribe el commit.

## Fuentes externas

- Adobe Portfolio original de Sole: solo lectura de contenido/assets.
- FullFoto / Cintia Zapico: referencia de UX de venta, no copiar marca ni fotos ajenas.
- Lifty / Tumo / otros clientes: no tocar salvo OK explícito.
