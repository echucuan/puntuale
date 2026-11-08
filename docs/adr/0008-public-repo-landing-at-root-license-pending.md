# ADR 0008 · Repositorio público, landing en la raíz y licencia pendiente

- **Fecha:** 2026-11-07
- **Estado:** Aceptado. **La licencia queda pendiente de aprobación explícita y de validación legal.**

## Contexto

El propietario quiere publicar el proyecto en su cuenta profesional, `github.com/echucuan/puntuale`, como parte de su portafolio. Ese repositorio ya existe, es público y publica la landing con GitHub Pages desde la raíz de `main`.

## Problema

¿Cómo conviven el monorepo y la landing ya publicada, y qué implica que el código sea público?

## Alternativas consideradas

1. **Repositorio privado:** protege el producto, pero no sirve como portafolio.
2. **Landing y plataforma en repositorios separados:** separa la visibilidad, pero duplica la configuración.
3. **Monorepo público, con la landing en la raíz sin cambios** (decisión R1) y `.nojekyll` (decisión R2).

## Decisión

- **Monorepo público:**
  - La landing (`index.html`, `script.js`, `styles.css` y `assets/`) se queda en la raíz y **no se modifica**.
  - `.gitattributes` conserva esos archivos byte a byte.
- **`.nojekyll` en la raíz:** evita que Pages procese con Jekyll la documentación del monorepo. Migrar Pages a GitHub Actions queda para una decisión posterior.
- **README:** el README de la raíz pasa a ser la entrada general del proyecto. La documentación de la landing se conserva en `docs/landing.md` (decisión R3).
- **Reglas por ser público:**
  - Nunca se suben secretos, datos reales, volcados de base de datos ni los PDF legales.
  - `.env.example` solo contiene valores ficticios.
  - La CI ejecuta un escáner de secretos.
- **Licencia, pendiente:**
  - El propietario prefiere “todos los derechos reservados”, pero **no se agrega ningún archivo `LICENSE`** hasta tener su aprobación explícita y una validación legal.
  - Mientras tanto aplica la regla general: sin licencia explícita, nadie más tiene permiso para reutilizar el código. **Esto no constituye asesoría legal.**

## Consecuencias

- Al integrar `feat/1.0-a-monorepo-base` en `main`, hay que comprobar manualmente que <https://echucuan.github.io/puntuale/> sigue funcionando.
- Mover la landing a `apps/landing` requerirá su propio ADR.
