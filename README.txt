Solución definitiva a la carga de Tailwind CSS y errores CORS
===========================================================

Al cargar los archivos HTML con el esquema `file://`, el navegador asigna
un origen `null`, lo que provoca que algunos servidores CDN (como
`cdn.tailwindcss.com`) bloqueen las peticiones por CORS. El resultado es
un mensaje de error como:

```
Access to script at 'https://cdn.tailwindcss.com/' from origin 'null' has been
blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the
requested resource.
```

Para evitar este bloqueo de forma definitiva, existen dos soluciones
recomendadas:

1. **Servir la aplicación desde un servidor local**.
   - Abra una terminal y sitúese en la carpeta donde descomprimió el proyecto.
   - Ejecute: `python -m http.server` (requiere Python instalado).
   - Esto inicia un servidor web en el puerto 8000. Acceda a
     `http://localhost:8000/index.html` en el navegador en lugar de
     abrir el archivo con `file://`. De este modo, el origen ya no
     es `null` y el navegador permitirá cargar los archivos de Tailwind
     sin problema.

2. **Incluir Tailwind CSS de forma local**.
   - Descargue el fichero `tailwind.min.css` desde un CDN autorizado, por
     ejemplo: `https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css`.
     Guarde este archivo en la carpeta del proyecto, por ejemplo como
     `tailwind.min.css`.
   - Reemplace la etiqueta `<script src="https://cdn.tailwindcss.com"></script>`
     en sus archivos HTML por una etiqueta de estilo local:

     ```html
     <link rel="stylesheet" href="tailwind.min.css">
     ```

   - De esta manera, la aplicación no realiza ninguna petición a un dominio
     externo y se evita el problema de CORS por completo.

Ambas opciones son válidas; la primera permite seguir usando la CDN sin
descargar nada adicional, siempre que se sirva la aplicación desde un
servidor local. La segunda elimina cualquier dependencia de un CDN.