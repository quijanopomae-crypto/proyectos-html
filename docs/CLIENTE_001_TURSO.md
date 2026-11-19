# Cliente 001 - Turso como base principal

## Decision de arquitectura
- **Fuente unica de verdad:** Turso libSQL, base `cliente-001-pos-db`.
- **API:** Cloudflare Worker exclusivo `cliente-001-pos-api`.
- **Web:** Cloudflare Worker exclusivo `cliente-001-pos-web`.
- **Respaldos independientes:** R2 privado cuando se configure, con restauracion probada.
- **D1:** base ya creada, pero debe permanecer vacia y desconectada de ventas mientras se use Turso.
- **No hay doble escritura** D1+Turso; una venta debe confirmarse en una sola base.
- **No se ha desplegado ni aplicado ninguna migracion remota.** No apto para ventas reales.

## Lo que ya existe
El POS incluye un adaptador Turso que traduce el protocolo HTTP libSQL a la interfaz
`prepare`, `bind`, `run`, `all`, `first`, `batch` usada por D1. Se selecciona
solo con `DB_PROVIDER=turso`.

Configuracion candidata: `tools/cloudflare-prod/wrangler.turso.jsonc`.
- No incluye binding D1.
- `CANONICAL_RUNTIME_ENABLED=disabled` hasta verificar el flujo de autoridad canonica.
- No incluye URL ni token de Turso.
- No modifica el Worker ni la D1 originales.

## Proximo paso de la cuenta Turso
1. Ingresar en https://app.turso.tech y crear una cuenta controlada para Cliente 001.
2. Crear una base **nueva y vacia** `cliente-001-pos-db`. Debe ser compatible con libSQL
   y el protocolo HTTP v3 que ya utiliza el adaptador; verificar modalidad en Turso.
3. Conservar URL `libsql://...` o `https://...` y token de acceso en lugar seguro.
4. **Nunca** copiar el token en chats, capturas, GitHub, codigo HTML o el navegador.
5. Cuando el Worker exclusivo este listo, configurar en su entorno **secrets** con los
   nombres exactos: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
   Comprobar cuenta Cloudflare activa antes de ejecutar `wrangler secret put`.
6. Desplegar solamente `cliente-001-pos-api` con
   `tools/cloudflare-prod/wrangler.turso.jsonc`, tras los controles.

## Migraciones
- Hay 36 migraciones en `infra/database/migrations`.
- Pasaron una prueba en SQLite descartable; **aun no en Turso remoto**.
- No usar `wrangler d1 migrations apply` para Turso: ese comando es exclusivo de D1.
- Se necesita un migrador Turso independiente que registre migraciones aplicadas,
  reanude sin repetirlas y pruebe restricciones, triggers, atomicidad e idempotencia.
- Una base vacia inicia la autoridad `LEGACY`; no poner `ACTIVE` manualmente.
  Validar el procedimiento de primera activacion CANON antes de la primera venta.

## Pruebas de salida antes de operar
- Autorizacion por roles y activacion exclusiva.
- Migraciones y triggers en Turso real; transacciones atomicas y reintentos seguros.
- Venta+stock+caja coherentes; creditos, pagos, duplicados, red intermitente.
- Cuentas y Worker sin conexion con Nuevo Amanecer.
- Respaldo cifrado fuera de la base y restauracion real a una base de prueba.
- Desplegar web solo despues de confirmar todas las anteriores.

## Riesgos
Turso introduce dependencia adicional de red desde Workers y sus propios limites.
No implica disponibilidad ilimitada ni sustituye un esquema de respaldos.
El repositorio de GitHub continua publico; no incorporar datos reales ni secretos.

Fuentes de precios y limites, verificados el 19/11/2026:
- https://turso.tech/pricing
- https://developers.cloudflare.com/d1/platform/limits/
