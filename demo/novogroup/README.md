# Sitio web público — Clínica Quirúrgica Novo Group (`web/`)

Sitio estático (HTML5, CSS3 y JavaScript sin frameworks) diseñado con enfoque *mobile-first*, accesible e instalable como Aplicación Web Progresiva (PWA) en Android.

## Estructura de `web/`

- `index.html`: Portada con propuesta de valor, accesos a las tres áreas principales y llamada a contacto.
- `servicios.html`: Visión general y articulación entre cirugías, UCI y hospitalización.
- `cirugias.html`: Guía para el paciente quirúrgico (preparación, día de la operación, recuperación y bloque reservado para procedimientos).
- `uci.html`: Información clara y tranquilizadora sobre la Unidad de Cuidados Intensivos y la comunicación con los familiares.
- `hospitalizacion.html`: Guía sobre la estancia, normas para acompañantes y proceso de alta médica.
- `contacto.html`: Datos de contacto (con marcadores visibles pendientes de confirmación), formulario con validación en el cliente y asistente de chat informativo.
- `css/estilos.css`: Hoja de estilos compartida (*mobile-first*, alto contraste, foco visible y soporte para `prefers-reduced-motion`).
- `js/main.js`: Menú móvil, validación accesible del formulario, widget de chat en cliente y registro del *service worker*.
- `js/sw.js`: *Service worker* que precachea la carcasa del sitio y prioriza la red en `localhost` para no interferir con el desarrollo.
- `manifest.webmanifest` e `img/`: Manifiesto web e iconos (`favicon-32.png`, `icono-192.png`, `icono-512.png`, `icono.svg`).

## Cómo servir el sitio en local

Desde la raíz del repositorio, ejecuta un servidor HTTP estático apuntando a `web/`:

```bash
cd web
python3 -m http.server 8080
```

Luego abre en tu navegador:

- `http://localhost:8080`

> **Nota sobre el Service Worker en desarrollo:** Cuando se accede desde `localhost` o `127.0.0.1`, `js/sw.js` consulta siempre la red (`cache: 'no-store'`) para que cualquier cambio en HTML, CSS o JS se refleje al recargar sin quedar atrapado en caché.

## Cómo probar la instalación como PWA en Android

Chrome en Android exige **HTTPS** (o `localhost` mediante reenvío de puertos por USB) para mostrar el aviso **"Instalar aplicación"** y activar el *service worker*. Puedes probarlo de dos maneras:

### Opción A: Por cable USB con Chrome DevTools (sin subir a internet)

1. Inicia el servidor local en tu PC con `python3 -m http.server 8080` dentro de `web/`.
2. Activa la **Depuración por USB** en tu teléfono Android y conéctalo a la PC.
3. En el navegador Chrome de tu PC, abre `chrome://inspect/#devices`.
4. Haz clic en **Port forwarding...**, agrega el puerto `8080` hacia `localhost:8080` y marca **Enable port forwarding**.
5. En Chrome de tu teléfono Android, entra a `http://localhost:8080`.
6. Abre el menú de tres puntos de Chrome en Android y selecciona **"Instalar aplicación"** (o **"Agregar a la pantalla principal"**). La clínica se abrirá en modo `standalone` (pantalla completa sin barra de direcciones).

### Opción B: Al publicar en un hosting con HTTPS (por ejemplo, GitHub Pages o Netlify)

1. Abre la URL HTTPS del sitio desde Chrome en un teléfono Android.
2. Toca el menú de Chrome y elige **"Instalar aplicación"**.
3. Una vez instalada, prueba activar el **Modo avión**: las 6 páginas del MVP, los estilos y el asistente orientativo seguirán funcionando gracias al precaché del *service worker*.
