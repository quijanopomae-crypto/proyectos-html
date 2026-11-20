# Cliente 001: primera autoridad CANON de tienda vacia

Estado al 20/11/2026: implementacion local y prueba en la base Turso temporal
`cliente-001-canon-temp-pr1-20261120`. No se ha consultado ni modificado la
base de produccion, desplegado Workers ni habilitado el runtime comercial.

## Contrato de inicializacion

- Turso es la unica base de ventas (`DB_PROVIDER=turso`). El Worker de API debe
  ser `cliente-001-pos-api`, con la URL exacta de la base exclusiva de Cliente 001,
  `RUNTIME_ENVIRONMENT=production` y `CANONICAL_RUNTIME_ENABLED=disabled`.
  La configuracion Turso no incluye binding D1.
- `0037_canonical_empty_bootstrap.sql` agrega un registro inmutable de autoridad
  inicial. Se aplica despues de las 36 migraciones existentes. Una base nueva
  conserva `canonical_control.mode=LEGACY` hasta que se invoque el procedimiento.
- Una sesion activa de dueño, obtenida con el secreto de activacion propio del
  cliente, envia `POST /commands/canonical.initialize-empty` con JSON exacto:

  ```json
  {"client_id":"cliente-001","operation_id":"<id-unico-para-esta-activacion>","expected_control_revision":0}
  ```

  Conservar el mismo `operation_id` al reintentar. La respuesta inicial es
  `201`; el mismo pedido repetido devuelve el recibo `200`. Un local con datos,
  una autoridad previa distinta o un fallo de integridad devuelve `409` y no
  activa CANON. Fuera del Worker exclusivo, la ruta responde `404`.
- En una sola transaccion se comprueba que no existan datos operativos ni
  importaciones previas, se registra una fuente sintetica `[]` de **cero filas**,
  se crea una promocion CANON vacia y se avanza
  `LEGACY → FROZEN → CANONICAL_READ_ONLY → ACTIVE`. Un trigger valida y registra
  la autoridad antes de permitir el ultimo cambio. Ningun dato de Nuevo Amanecer
  entra en la base.
- El migrador acepta una segunda ejecucion con `ACTIVE` solo si encuentra el
  registro inicial, la promocion comprometida y la fuente vacia coherentes.
  `CANONICAL_RUNTIME_ENABLED` sigue desactivado hasta un cambio posterior y
  separado de configuracion.

## Comprobacion local

Desde la raiz del repositorio:

```text
python3 tests/client-001/migraciones_sqlite.py
node --test tests/client-001/canon-initialization.test.mjs
node --check scripts/client-001-migrate/migrate.mjs
```

La prueba de inicializacion usa el Worker real y el adaptador HTTP libSQL, pero
intercepta el transporte y ejecuta SQL en SQLite en memoria. Comprueba permisos,
aislamiento Turso/D1, rechazo de datos previos, rollback, reintentos y una
secuencia de producto, inventario, caja, venta, credito y pago. La comprobacion
de transacciones y triggers en Turso remoto se resume a continuacion.

## Verificacion en Turso temporal

Usar una base nueva cuyo nombre comience por `cliente-001-canon-temp-`, con URL
y token propios. No copiar ni restaurar datos de produccion o Nuevo Amanecer.
El migrador solo admite esa URL al definir
`CLIENT001_MIGRATION_TARGET=temporary`; su destino normal sigue limitado a la
URL exacta de produccion. Instalar `@libsql/client@0.18.0` en
`scripts/client-001-migrate` como en el workflow existente y, con las
credenciales temporales solo en variables del proceso, ejecutar en este orden:

1. `node scripts/client-001-migrate/migrate.mjs`: aplicar 0001 a 0037 y
   comprobar 37 registros y control `LEGACY`.
2. `node scripts/client-001-migrate/verify-temporary.mjs`: comprobar que el
   trigger impide `LEGACY → ACTIVE` directo; forzar un fallo a mitad de la
   inicializacion y verificar rollback; repetir sin el fallo para registrar la
   autoridad, luego comprobar reintento identico, conflicto e inmutabilidad.
   El script llama el mismo inicializador y adaptador Turso del Worker. La ruta
   publica sigue cerrada para la URL temporal.
3. `node scripts/client-001-migrate/migrate.mjs` nuevamente: comprobar que
   los hashes de las 37 migraciones y la autoridad `ACTIVE` son coherentes.

No ejecutar estos comandos con el token o URL de produccion. Esta verificacion
no despliega Workers y deja `CANONICAL_RUNTIME_ENABLED=disabled`. El verificador
del paso 2 parte de `LEGACY`; para repetirlo se necesita otra base temporal
vacia.

### Resultado observado el 20/11/2026

- El migrador aplico 0001 a 0037 en la base temporal vacia y dejo
  `canonical_control` en `LEGACY`, revision 0.
- Turso impidio el cambio SQL directo `LEGACY -> ACTIVE` con `gate_p_control`.
  Un trigger de aborto temporal produjo el error esperado
  `client001_temp_rollback`; la transaccion retiro fuente, promocion,
  autoridad y aserciones, dejando el control en `LEGACY`.
- La siguiente inicializacion devolvio `201`, registro una sola autoridad,
  promocion `COMMITTED` y fuente `PASS` de cero filas. El mismo pedido devolvio
  `200` con el mismo recibo; otro `operation_id` devolvio `409`. Los triggers
  rechazaron modificar o borrar la autoridad. Productos, clientes y ventas
  permanecieron vacios.
- Una consulta de solo lectura en la consola de esa base mostro 37 migraciones,
  `ACTIVE`, revision 3, epoca 3 y una autoridad. La consulta de integridad
  usada por el migrador para relacionar control, autoridad, promocion y fuente
  devolvio `authority_ok=1`.
- La reejecucion final del migrador por CLI se intento, pero la conexion al
  host temporal agoto el tiempo antes de completar la lectura. Las consultas
  anteriores verifican el estado posterior a la inicializacion; no sustituyen
  la comprobacion de hashes que hace ese migrador. La ruta publica permanecio
  cerrada (`404`) para la URL temporal; el verificador invoco el inicializador
  y adaptador Turso del Worker de forma directa.

## Secuencia de produccion, pendiente de autorizacion

Codex ejecutara esta secuencia solo despues de presentar la evidencia temporal
y recibir autorizacion expresa para modificar produccion:

1. Fusionar el PR aprobado en `main`. Verificar la URL exacta de la base
   exclusiva de Cliente 001, sus secrets y el Worker `cliente-001-pos-api`.
   Comprobar en solo lectura que la base no contiene datos comerciales de otra
   tienda. Detenerse ante cualquier dato previo inesperado.
2. Disparar desde `main` el workflow manual
   `.github/workflows/cliente-001-turso-migraciones.yml`, que usa los secrets
   `CLIENT001_TURSO_DATABASE_URL` y `CLIENT001_TURSO_AUTH_TOKEN`.
   Si la base es nueva, aplica 0001 a 0037; si las 36 anteriores ya estan
   registradas con los mismos hashes, aplica solo 0037. Exigir 37/37 y
   `canonical_control.mode=LEGACY`. Nunca escribir `ACTIVE` con SQL.
3. Configurar los tres secrets del Worker exclusivo
   (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `POS_ACTIVATION_SECRET`) sin
   imprimirlos ni guardarlos en el repositorio. Desplegar solamente la API
   usando `tools/cloudflare-prod/wrangler.turso.jsonc`: Turso principal, sin
   binding D1 y `CANONICAL_RUNTIME_ENABLED=disabled`. No desplegar la web ni
   habilitar ventas durante esta fase.
4. En la URL verificada de esa API, llamar `POST /auth/activate` con la cabecera
   `x-activation-secret: <POS_ACTIVATION_SECRET>` y exigir `200` con
   `session_token`. Conservar fuera del repositorio un `operation_id` unico y
   enviar `POST /commands/canonical.initialize-empty` con cabeceras
   `Authorization: Bearer <session_token>` y `Content-Type: application/json`,
   y cuerpo
   `{"client_id":"cliente-001","operation_id":"<id>","expected_control_revision":0}`.
   Aceptar `201` o `200` solo si el recibo coincide; ante duda reintentar
   exactamente el mismo pedido. Ante `409`, detenerse y diagnosticar sin
   modificar `canonical_control` manualmente.
5. Verificar en solo lectura con el siguiente resumen: una fila con
   `migrations=37`, `mode=ACTIVE`, `revision=3`, `authority_epoch=3`,
   `active_promotion_id=cliente-001-empty-canon`, `authorities=1` y
   `staging_rows=products=customers=sales=0`.

   ```sql
   SELECT (SELECT COUNT(*) FROM __cliente001_schema_migrations) AS migrations,
          mode, revision, authority_epoch, active_promotion_id,
          (SELECT COUNT(*) FROM canonical_initial_authority) AS authorities,
          (SELECT COUNT(*) FROM import_staging) AS staging_rows,
          (SELECT COUNT(*) FROM products) AS products,
          (SELECT COUNT(*) FROM customers) AS customers,
          (SELECT COUNT(*) FROM sales) AS sales
   FROM canonical_control WHERE id=1;
   ```

   Confirmar tambien `import_runs.import_id='cliente-001-empty-source'`,
   `status='PASS'`, `row_count=0`, y
   `canonical_promotions.promotion_id='cliente-001-empty-canon'`,
   `status='COMMITTED'`, `candidate_revision=sealed_revision=0`. Repetir el
   migrador para comprobar hashes y la relacion completa de autoridad.
6. Mantener `CANONICAL_RUNTIME_ENABLED=disabled` tras la inicializacion. La
   habilitacion comercial requiere una comprobacion y decision separadas.
