# TransferLog organizado

Esta carpeta contiene la misma app separada en archivos más mantenibles:

- `index.html`: estructura de la interfaz.
- `styles.css`: estilos visuales y responsive.
- `app.js`: lógica de datos, renderizado, PDF, configuración local e inicialización.

## Cambios agregados

- Configuración ahora permite guardar choferes, solicitantes, áreas, empresas y centros de costo.
- El recibo usa esos datos como listas desplegables.
- Se agregó el campo `Paradas adicionales`.
- Configuración permite definir el valor en pesos por parada adicional.
- El total del recibo suma automáticamente `paradas adicionales × valor por parada`.
- La app intenta conectarse automáticamente a Supabase al abrir.

## Campos nuevos para Supabase

Si tu tabla `receipts` todavía no tiene estos campos, ejecútalo una vez en el SQL Editor de Supabase:

```sql
alter table receipts
add column if not exists paradas_adicionales integer default 0;
```

## Siguiente mejora recomendada

Para una etapa más profesional todavía, conviene reemplazar los `onclick` del HTML por `addEventListener` en `app.js`, y mover los estilos inline que se crean dentro de plantillas JavaScript a clases CSS dedicadas.
