# Cliente 001 - Instalacion de nube independiente

Estado comprobado el 19/11/2026:
- Copia de codigo en quijanopomae-crypto/proyectos-html.
- Pruebas offline de 36 migraciones y activacion del navegador: PASS.
- No hay base D1 remota, Worker remoto, secreto de activacion ni respaldo R2 para Cliente 001.
- No publicar ni registrar ventas reales todavia.

## Paso A: proteccion del repositorio
1. En GitHub: Settings > General > Change repository visibility > Private.
2. Desactivar GitHub Pages si no se utilizara.
3. El historial del anterior proyecto todavia existe; para borrarlo totalmente se necesita un repositorio nuevo sin el historial viejo.

## Paso B: abrir cuenta Cloudflare del Cliente 001
1. Abrir https://dash.cloudflare.com/ e iniciar sesion en una cuenta EXCLUSIVA del cliente.
2. No usar la cuenta Cloudflare en la que opera Nuevo Amanecer original.
3. Abrir la seccion Storage & databases > D1 SQL database (los nombres del menu pueden variar).
4. Crear una base SQL D1 nueva llamada **cliente-001-pos-db**. Debe estar vacia.
5. Copiar solamente el **Database ID** (UUID) creado por Cloudflare. El ID no es una contraseña.
6. No pegar en chats, archivos de GitHub ni capturas ninguna API key, contraseña o token secreto.

## Paso C: conectar la base (cuando exista)
Archivo: tools/cloudflare-prod/wrangler.jsonc
- Mantener "binding": "DB".
- Mantener "database_name": "cliente-001-pos-db".
- Sustituir REEMPLAZAR_CON_D1_EXCLUSIVA_DEL_CLIENTE por el UUID NUEVO de Cliente 001.
- Confirmar que el UUID NO sea el de la tienda original.
- Mantener CANONICAL_RUNTIME_ENABLED = "disabled" durante todo el preflight.

## Paso D: migraciones y autoridad comercial
Los SQL se encuentran en infra/database/migrations/ (36 archivos).
La prueba offline comprobo que se aplican sobre SQLite vacia.
La aplicacion en Cloudflare D1 remoto NO ha sido ejecutada; requiere verificar la cuenta y probar D1.
Comando de referencia (solo despues de configurar la nueva D1 y revisar):
    cd tools/cloudflare-lab
    npx wrangler d1 migrations list cliente-001-pos-db --remote --config ../cloudflare-prod/wrangler.jsonc
    npx wrangler d1 migrations apply cliente-001-pos-db --remote --config ../cloudflare-prod/wrangler.jsonc

ADVERTENCIA: en una D1 nueva, canonical_control.mode se inicializa como LEGACY.
No cambiar manualmente el modo a ACTIVE ni hacer ventas hasta cerrar el procedimiento
de inicializacion canonica para negocio vacio y probar venta, caja, stock, creditos e idempotencia.

## Paso E: nube y respaldos propios
- Worker API del cliente: cliente-001-pos-api.
- Worker web del cliente: cliente-001-pos-web.
- Configurar URL web y CANON_API_ORIGIN exclusivos del cliente.
- Crear un POS_ACTIVATION_SECRET nuevo en Cloudflare para este Worker solamente.
- Crear R2 privado, propio del cliente, para respaldos y probar una restauracion.
- Mantener las operaciones comerciales desactivadas hasta los test de seguridad y ventas.

## Evidencia
La CI de GitHub Actions: "Cliente 001 - comprobaciones sin nube" usa datos
descartables y no necesita secretos, claves ni permisos de Cloudflare.
Su resultado valida la preparacion offline, NO garantiza aun una instancia comercial.
