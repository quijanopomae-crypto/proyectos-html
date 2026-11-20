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
