# Cliente 001: primera autoridad CANON de tienda vacia

Estado al 20/11/2026: implementacion y pruebas **solo locales**. En este trabajo
no se han aplicado estas migraciones a Turso remoto, cambiado datos remotos ni
desplegado Workers con este procedimiento.

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
secuencia de producto, inventario, caja, venta, credito y pago. No demuestra
todavia que los triggers y las transacciones funcionen identicamente en Turso
remoto. Esa comprobacion precede cualquier habilitacion comercial real.

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
no despliega Workers y deja `CANONICAL_RUNTIME_ENABLED=disabled`.

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
4. En el URL verificado de esa API, llamar `POST /auth/activate` con el
   secreto de activacion para obtener una sesion de dueño. Conservar fuera del
   repositorio un `operation_id` unico y enviar una sola vez
   `POST /commands/canonical.initialize-empty` con
   `{"client_id":"cliente-001","operation_id":"<id>","expected_control_revision":0}`.
   Aceptar `201` o `200` solo si el recibo coincide; ante duda reintentar
   exactamente el mismo pedido. Ante `409`, detenerse y diagnosticar sin
   modificar `canonical_control` manualmente.
5. Verificar en solo lectura: `canonical_control` en `ACTIVE`, revision y
   epoch 3; una fila inmutable en `canonical_initial_authority`; promocion
   `cliente-001-empty-canon` en `COMMITTED`; fuente
   `cliente-001-empty-source` con cero filas; `import_staging`, productos,
   clientes y ventas todavia vacios. Repetir el migrador para validar la
   autoridad registrada.
6. Mantener `CANONICAL_RUNTIME_ENABLED=disabled` tras la inicializacion. La
   habilitacion comercial requiere una comprobacion y decision separadas.
