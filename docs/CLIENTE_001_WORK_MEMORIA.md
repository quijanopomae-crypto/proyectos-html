# Cliente 001: memoria de imágenes de WORK

## Corrección

WORK guarda en memoria volátil el sobre invoice_memory que devuelve el servidor y lo reenvía intacto, sin decodificarlo ni modificar su firma. Nueva conversación, cierre o cambio de identidad lo eliminan; la generación de petición impide que una respuesta antigua lo restaure. Otra foto sustituye la memoria; una respuesta null la elimina. Si no puede conservar la lectura, se indica al usuario.

Se reutilizan pos-assistant-invoice-memory.js y leer_factura_compra. El extracto se toma de la lectura de la herramienta antes del emparejamiento con CANON, conserva nombres impresos, cantidades, precios, totales impresos y notas de paquetes. No recalcula los totales ni convierte cantidades. La información es de la foto, no una afirmación sobre el inventario.

Las consultas de conteo y enumeración de la boleta recordada usan esos datos para producir la respuesta completa, sin herramientas de catálogo. El prompt permite enumerar todas las filas y prohíbe sustituir la foto por el catálogo. El puente iframe continúa transportando mensajes: la memoria firmada solo vive en el host, no en el iframe ni en almacenamiento persistente.

## ASSISTANT_CONFIRM_SECRET

No fue posible verificar su presencia real en Cloudflare: este entorno no ofrece credenciales Cloudflare ni control de la sesión del navegador. Que no figure en el archivo local no acredita que falte en el Worker. La configuración Turso ahora lo declara como secreto requerido; no contiene su valor.

Antes de cualquier despliegue, con acceso autorizado a la cuenta correcta, consultar SOLO metadatos mediante `wrangler secret list --config tools/cloudflare-prod/wrangler.turso.jsonc`. Si ya existe ASSISTANT_CONFIRM_SECRET, conservarlo: rotarlo invalida memorias y confirmaciones existentes. Si falta, obtener autorización para añadirlo al Worker exclusivo cliente-001-pos-api y generar 32 bytes aleatorios criptográficos. Guardarlo mediante el campo Secret del panel Cloudflare o entrada estándar de wrangler secret put, sin imprimirlo, pegarlo en chats, pasarlo como argumento ni guardarlo en Git. El uso del secreto no requiere cambiar datos Turso.

No se ha generado, añadido, reemplazado ni desplegado ningún secreto en esta tarea. No se cambia CANONICAL_RUNTIME_ENABLED. La presencia en metadatos no garantiza que su valor cumpla la longitud mínima; la prueba funcional firmada tras el despliegue es necesaria.

## Evidencia y límites

Caso de prueba transcrito manualmente del ticket proporcionado: ocho productos; total impreso S/ 1,093.35; unidades impresas 311. La fila Valle Verde conserva cantidad impresa 5 y la nota 5 paquetes x 12 = 60 unidades; no se convierte automáticamente. También conserva diferencias entre multiplicación y total impreso.

Las pruebas simulan la respuesta estructurada del proveedor visual: no son una prueba OCR real. Verifican la lectura estructurada inicial, dos preguntas sin reenviar foto, nombres/cantidades/precios/totales y ausencia de productos de catálogo en la respuesta de enumeración. Verifican rechazo de memoria alterada, vencida o de otra sesión, limpieza y respuesta tardía tras reset.

No se escribieron ventas ni datos Turso, no se modificó Nuevo Amanecer original y no se desplegó. Después de revisar el PR y autorizar el despliegue, deberá probarse con la fotografía real y el proveedor configurado, confirmar que regresa invoice_memory no nulo, preguntar el conteo y pedir las ocho filas sin adjuntar de nuevo la imagen.

## Validación local

56 pruebas focalizadas correctas (memoria, producto de factura, host, voz, inicialización, roles de acceso y adaptador Turso). Las pruebas específicas del prompt y tamaño de payload también pasan.

La primera batería amplia ejecutó 1.249 pruebas y detectó 13 fallos. Se corrigieron las dos regresiones del prompt/tamaño introducidas durante esta implementación y se reejecutaron sus pruebas con éxito. Los demás incluyen archivos ausentes (demo-data.mjs, CONTRATO.md y un workflow histórico), expectativas antiguas de nombre comercial y CSS, y dos umbrales de rendimiento. Los fallos funcionales ajenos al parche se reproducen en un checkout limpio de main; los umbrales dependen de la carga y se registran por separado. No se afirma que la batería amplia esté completamente verde.

Para instalar este parche deberán publicarse los assets web de Cliente 001 y la API de Cliente 001, con autorización previa. Desplegar únicamente la API no actualiza work-host.js del navegador. No ejecutar migraciones ni tocar ventas para instalar esta corrección.

### Fallos ajenos al parche observados en la batería amplia

Reproducidos en main:
- assistant-admin.test.mjs: falta tools/asistente-proto/demo-data.mjs.
- assistant-mensaje-largo-varios.test.mjs: falta el mismo demo-data.mjs.
- assistant-canon-config.test.mjs: falta .github/workflows/v1.3-turso-prod-worker-hotfix.yml.
- assistant-followups-25ffde10.test.mjs: «la tabla se crea con su primera fila… sin :has»; el CSS existente contiene :has.
- assistant-followups-3ee80c18.test.mjs: «CONTRATO.md: 409 same_session…»; falta docs/asistente/CONTRATO.md.
- assistant-followups-5646a4c9.test.mjs: «CONTRATO.md: año con…»; falta el mismo documento.
- assistant-followups-f773911f.test.mjs: «11) /confirm no guarda ni cambia el nivel de un empleado…»; falta el mismo documento.
- assistant-simple.test.mjs: «403: el texto de asistente-core.js es EXACTAMENTE el de CONTRATO.md»; falta el mismo documento.
- assistant-memoria-celular.test.mjs: «nombre del negocio: el de Configuración; sin él Nuevo Amanecer»; expectativa histórica del nombre comercial.
- Umbral «1) correo: 50 KB… corrida más rápida…»: también falló en main.

El umbral «8b) Bot 3: costo lineal con pin pin pin…» falló bajo carga en la batería amplia y pasó en la repetición aislada de main. No se atribuye su causa al parche ni se garantiza estabilidad temporal de ese umbral.

Las dos regresiones intermedias propias (assistant-simple: regla de 2–3 frases; assistant-proponer-configuracion: presupuesto de payload) se corrigieron y sus pruebas específicas pasan en el estado final.
