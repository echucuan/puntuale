# Landing pública de Puntuale

> **Estado: Implementado.** Este documento conserva el contenido del README original de la landing (commit `725ac2d`) y describe su situación actual dentro del monorepo.

## Qué es

Landing de Puntuale con la identidad visual de la marca, diseño adaptable y una demostración de asistencia con **datos ficticios**. Está hecha con HTML, CSS y JavaScript, sin compilación ni backend.

La landing **no es una aplicación productiva**:

- La demo no guarda datos.
- No crea cuentas ni registra asistencia real.
- No incluye métricas comerciales, testimonios ni promesas de cumplimiento legal.

## Ubicación (decisión R1)

La landing vive en la **raíz del repositorio** y no se modifica durante la construcción de la plataforma:

| Archivo                                 | Contenido                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `index.html`                            | Página única con hero, demo interactiva, vista de periodo, “Cómo funciona”, preguntas frecuentes y cierre. |
| `styles.css`                            | Estilos y tokens de color (`:root`).                                                                       |
| `script.js`                             | Demo de registro (sin registro → entrada → salida) y filtro “Todos / Por revisar”.                         |
| `assets/logo.png`, `assets/isotipo.png` | Logo principal e isotipo.                                                                                  |

`.gitattributes` marca `index.html`, `script.js` y `styles.css` como `-text`, porque los dos últimos tienen finales de línea mixtos en el historial. Así git los conserva byte a byte y ninguna normalización los modifica sin querer.

Moverla a `apps/landing` es una **decisión posterior**. Exigiría cambiar el origen de GitHub Pages a GitHub Actions.

## Vista local

Abre `index.html` en un navegador o sirve la raíz del repositorio con cualquier servidor HTTP estático.

## Publicación en GitHub Pages

- Repositorio: `echucuan/puntuale`.
- URL: <https://echucuan.github.io/puntuale/>.
- **Origen actual:** por el contenido del repositorio, Pages parece publicar **desde la rama `main`**. No hay ningún workflow en `.github/`. El README original mencionaba un workflow de GitHub Actions, pero ese archivo nunca se subió al remoto. El propietario debe confirmar la configuración en _Settings → Pages_.
- **`.nojekyll`** (decisión R2): está en la raíz para que Pages no procese con Jekyll los documentos Markdown del monorepo. Pages publica los archivos tal cual, por lo que la documentación también queda accesible como texto en el sitio. El repositorio es público, así que esto no expone nada adicional.

> **Verificación pendiente:** cuando la rama `feat/1.0-a-monorepo-base` se integre a `main`, hay que abrir <https://echucuan.github.io/puntuale/> y confirmar que la landing se sigue viendo igual.

## Identidad visual

| Elemento         | Valor                |
| ---------------- | -------------------- |
| Azul profundo    | `#0F2C52`            |
| Azul profesional | `#1769AA`            |
| Azul claro       | `#EAF3FB`            |
| Gris cálido      | `#F3F5F7`            |
| Carbón           | `#202124`            |
| Tipografía       | Montserrat (400–800) |

La plataforma reutiliza estos tokens en `packages/ui`.
