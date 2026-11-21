# Cliente 001: parche de lectura CANON por sesión

El manejador CANON acepta una sesión validada por authorizeSession, que comprueba credencial, revocación y permisos de ruta. Conserva el rol para omitir gastos del snapshot de empleados. Sin sesión se conserva el gateway READ_TOKEN; una sesión inválida no puede recurrir a ese token para eludir el rechazo.

En main el Worker ya pasaba authorizePermissionRead, que aceptaba sesiones. Por tanto, el requisito de un segundo token no se reproducía en la ruta real: se duplicaba la validación. El parche elimina esa dependencia en el manejador. No demuestra que este fuera el único bloqueo de producción; el runtime desactivado seguirá devolviendo 404.

## Despliegue preparado, no ejecutado

Tras revisión/fusión y autorización del propietario:

1. Confirmar el commit aprobado, cuenta de Cloudflare y destino exclusivo cliente-001-pos-api.
2. Usar únicamente tools/cloudflare-prod/wrangler.turso.jsonc. Comprobar DB_PROVIDER=turso, ausencia de binding D1 y CANONICAL_RUNTIME_ENABLED=disabled. Conservar los secretos existentes sin imprimirlos.
3. Desplegar con `npx wrangler deploy --config tools/cloudflare-prod/wrangler.turso.jsonc` desde la raíz del repositorio usando la versión fijada en tools/cloudflare-lab. No desplegar la web ni ejecutar migraciones o inicialización CANON.
4. Comprobar health y confirmar runtime desactivado. Las lecturas CANON devolverán 404 hasta una activación separada autorizada.
5. Solo después de autorizar la activación final: habilitar runtime y comprobar con sesión de dueño status/snapshot, rechazo anónimo, rechazo de sesión inválida/revocada y restricciones de empleado. No registrar tokens ni crear ventas de prueba en producción sin autorización.

No se cambia ningún dato Turso, secreto o configuración de runtime con este parche. CANON ACTIVE revisión 3/época 3 en producción es información proporcionada por el propietario, no verificada remotamente en esta tarea.
