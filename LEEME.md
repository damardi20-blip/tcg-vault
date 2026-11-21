# TCG Vault

App web (instalable en el iPhone con icono) para llevar tu colección de cartas Pokémon con precios
que se actualizan solos cada día. Todo gratis.

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `style.css`, `app.js` | La app (pantallas, colección, precios, gráficas) |
| `scanner.js` | Escáner con la cámara: lee el texto y compara la imagen con el catálogo |
| `data/index.json` | Lista de colecciones (de Base Set a hoy) |
| `data/sets/<id>.json` | Cartas de cada colección (nombre por idioma, número, rareza, variantes) |
| `data/prices/<id>.json` | Precios del día de cada colección (Cardmarket y CardTrader por idioma) |
| `data/history/<id>.json` | Un precio por carta y día, para las gráficas |
| `data/search.json` | Índice ligero de todas las cartas (buscador global y escáner) |
| `scripts/update-data.mjs` | Script que descarga cartas y precios (lo ejecuta GitHub cada día) |
| `.github/workflows/publicar.yml` | Tarea diaria: actualiza precios y publica la web |
| `firebase-config.js`, `firestore.rules.txt` | Sincronización opcional entre dispositivos |
| `sw.js`, `manifest.json`, `icons/` | Para instalarla como app y que funcione sin conexión |

La carpeta `data/` no se sube a la rama principal: GitHub la genera cada día y la guarda en la
rama `datos` (un único commit que se reescribe, para que el repositorio no crezca).

## Probarla en el ordenador

```bash
node scripts/update-data.mjs   # la primera vez, para descargar los datos
node server.js
```

y abre http://localhost:8090

## Publicarla gratis (GitHub Pages), igual que la app de cocina

1. Crea un repositorio nuevo en GitHub (p. ej. `tcg-vault`) y sube esta carpeta.
2. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions → Read and write**.
4. Pestaña **Actions → "Actualizar precios y publicar la app" → Run workflow**. La primera vez
   descarga todas las cartas (unos 15-30 minutos); los días siguientes solo los precios (1-2 minutos).
5. Tendrás la app en `https://TU-USUARIO.github.io/tcg-vault/`.

## Ponerla en el iPhone

Abre el enlace en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
Para pasársela a un amigo, mándale el mismo enlace. Cada uno tiene su propia colección.

## Precios por idioma (CardTrader)

1. Crea una cuenta gratis en cardtrader.com.
2. En tu perfil → **Settings → API** (o "Full API App Token") copia el token.
3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   con nombre `CARDTRADER_TOKEN` y el token como valor.
4. Lanza la tarea a mano (paso 5 de arriba). A partir de ahí la ficha de cada carta muestra el
   precio más barato en NM en español, inglés, italiano y japonés, y la colección se valora con el
   precio del idioma de cada carta.

El token **nunca** se pone en los archivos de la app: solo vive en los secretos de GitHub.

## Sincronizar entre dispositivos (opcional)

Igual que el "código de hogar" de la app de cocina: sigue las instrucciones de `firebase-config.js`
(proyecto nuevo de Firebase, plan gratuito). Luego en **Ajustes → Crear código** y, en el otro
dispositivo, **Ajustes → Unirme** con ese código.

## Colecciones incluidas

Todas las expansiones principales desde Base Set (1999) hasta hoy, incluidas las especiales
(151, Evoluciones Prismáticas, Destinos Ocultos, Shiny Vault, Trainer Gallery…). Las nuevas que
publique TCGdex se añaden solas. Se excluyen promos, energías y productos sueltos: la lista está en
`EXCLUDE` dentro de `scripts/update-data.mjs`. Las colecciones antiguas (antes de Negro y Blanco)
solo tienen nombres e imágenes en inglés en TCGdex, pero puedes guardarlas en cualquier idioma.

## Fuentes de datos

- Cartas e imágenes: [TCGdex](https://tcgdex.dev) (gratis, sin clave).
- Precios: guía de precios pública de Cardmarket (un archivo con todas las cartas, gratis).
- Precio por idioma: API de CardTrader (gratis con cuenta).
- Lector de texto del escáner: Tesseract.js (se ejecuta en el propio móvil).
