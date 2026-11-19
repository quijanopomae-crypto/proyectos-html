# POS Cliente 001 - Copia aislada

Copia de codigo fuente tomada del POS Nuevo Amanecer.
Origen fijo: f45c64332377d1c5aa00575b23dbb1a678a1f093

**ESTADO: NO APTO PARA OPERAR, SIN NUBE HABILITADA.**
Los endpoints conocidos del negocio original se sustituyeron por dominios invalidos.
Los workflows de produccion originales, secretos y datos no fueron importados.
NO compartir credenciales, respaldos o base de datos con el POS original.

## Almacenamiento propio pendiente
1. Crear D1 de cliente: cliente-001-pos-db (vacia).
2. Reemplazar el ID ficticio en tools/cloudflare-prod/wrangler.jsonc.
3. Aplicar migraciones desde infra/database/migrations y verificar integridad.
4. Crear secreto POS_ACTIVATION_SECRET nuevo, exclusivo del cliente.
5. Crear respaldos R2 exclusivos y probar restauracion.
6. Desplegar Workers propios API y web; configurar CANON_API_ORIGIN exclusivo.
7. Probar login, ventas, caja, inventario, credito, sincronizacion y recuperacion.
8. Habilitar runtime solo tras verificaciones, sin acceso al entorno original.
9. Hacer privado el repositorio antes de personalizarlo con datos comerciales.

El contenido del proyecto anterior sale de main, pero el historial Git
anterior sigue siendo consultable. Una purga real exige recrear el repo.
