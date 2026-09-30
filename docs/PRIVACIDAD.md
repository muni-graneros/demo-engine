# Privacidad: el portero

El motor protege datos sensibles **durante la grabación** tapando la pantalla desde el primer frame hasta que los datos están a salvo de mostrarse de más. Esto es crítico porque muchas aplicaciones (Filament, Livewire, etc.) pintan **la tabla completa** y luego la filtran con JavaScript — esa ventana es la fuga que el motor debe bloquear.

Son cuatro controles encadenados, y ninguno reemplaza al otro:

| Control | Cuándo actúa | Se apaga con |
|---|---|---|
| `exigirEntornoDeDesarrollo` | antes de abrir el navegador | nada (solo `DEMO_FORZAR=1`) |
| Chequeo en vivo por paso | al cerrar cada paso, antes de la captura | `paso.variasPersonas` o `auditoria.chequeoEnVivo: false` |
| `abrirFiltrado` / `abrirVerificado` | mientras se pinta una pantalla con datos | es opt-in: lo llama el guion |
| [`demo auditar`](AUDITORIA.md) | sobre el MP4 y las capturas ya en disco | es un comando aparte |

### Invariante de privacidad

**Jamás se graba un dato sensible sin protección.** Dos niveles:

1. **Entorno declarado a mano:** `exigirEntornoDeDesarrollo(config.baseURL)` exige
   `DEMO_ENTORNO=local|testing|development` (o `APP_ENV` con uno de esos valores) y, además,
   que el host no sea público. **Sin declaración no se graba**: el defecto es negar.
   Antes esto se deducía de la IP —cualquier `10.x`, `192.168.x` o loopback se daba por
   desarrollo— y eso es exactamente lo que había que sacar: en la red municipal la VPN
   interna y **los sistemas en producción** viven en esos mismos rangos privados, así que la
   inferencia relajaba el guardián justo donde hay datos reales de vecinos.
2. **Pantalla tapada hasta que se cumple una condición:** `abrirFiltrado`/`abrirVerificado` cubren la pantalla, abren la URL, esperan a que una condición se cumpla **de forma estable**, y solo entonces destapan. Si la condición no se cumple, **la pantalla se queda tapada y la función lanza** — nunca se graba "por las dudas".

### Chequeo en vivo: el motor se niega a grabar varias personas

`abrirFiltrado`/`abrirVerificado` son **opt-in**: nada obligaba a un guion a llamarlas, y una
auditoría real encontró 4 de 10 guiones de un sistema en uso que no lo hacían, dejando varias
personas a la vista. Por eso el diseño está invertido: **al cerrar cada paso**, justo antes de
la captura que va al manual, el grabador lee el DOM (sin OCR, 4-6 ms medidos) y cuenta
identificadores distintos con el `patron`/`validar` de `config.auditoria`. Si hay más de uno,
cubre la pantalla de inmediato y **lanza**: la toma completa se descarta y de esa corrida no
sale ningún video.

Los identificadores salen **enmascarados** en el mensaje de error —el portero salta
justamente cuando hay datos reales a la vista, que es el peor momento para copiarlos a la
consola o al log de CI—; con `DEMO_DEPURAR=1` salen completos para investigar un falso
positivo.

La excepción se declara a propósito, paso por paso, para las pantallas donde mostrar varias
personas es lo correcto (un reporte agregado, una cola de atención):

```js
{ actor: 'funcionario', narrar: 'La cola del día.', variasPersonas: true, hacer: async (page) => { … } }
```

Se apaga por sistema con `auditoria.chequeoEnVivo: false` (interruptor explícito, deja
`patron`/`validar` intactos para que `demo auditar` los siga usando) o con
`auditoria.patron: null` (no hay nada que buscar). **Nunca se apaga por omisión.**

### Cuál usar: `abrirFiltrado` vs `abrirVerificado`

`abrirVerificado(page, url, comprobar, opciones?)` es la función genérica: `comprobar` es un
predicado de solo lectura sobre el DOM ya pintado, y `abrirVerificado` lo llama en un bucle
hasta que da verdadero varias veces seguidas (o se acaba el tiempo, y ahí lanza). No asume
nada sobre la pantalla — ni que hay un buscador, ni qué significa "estar filtrado" — así que
sirve para **cualquier** pantalla con datos de varias personas.

`abrirFiltrado` es el caso más común de eso: pantallas **con un buscador** que reduce una
tabla a una sola fila. Está construido sobre `abrirVerificado` (le pasa `preparar` para
escribir el filtro y apretar enter, y `comprobar` para contar las filas).

Usa `abrirFiltrado` cuando la pantalla tiene un campo de búsqueda. Usa `abrirVerificado`
cuando no hay nada que escribir. **Ejemplo:** una cola de atención del día lista a quien sea
que esté citado ahora — sin buscador, porque no tiene sentido "filtrar" una cola. Ahí
`abrirFiltrado` no aplica: el predicado tiene que juzgar directamente lo que quedó pintado.

```js
import { abrirVerificado } from 'demo-engine';

await abrirVerificado(page, baseURL + '/admin/mi-turno', async () => {
  const nombres = await page.locator('.mt-item-nom').allTextContents();
  return nombres.every(esPermitido);   // TODOS deben estar permitidos
});
```

### Ejemplo: filtrar solicitudes por RUT

```js
import { abrirFiltrado, exigirEntornoDeDesarrollo } from 'demo-engine';

// En config
export default {
  baseURL: 'http://127.0.0.1:8000',  // Solo localhost/red privada
  // ...
};

// En el guion
{
  actor: 'funcionario',
  narrar: 'Buscamos al ciudadano por su RUT.',
  hacer: async (page) => {
    // Abre /panel, cubre la pantalla, filtra por RUT, destapa solo cuando 
    // la tabla tenga una sola fila.
    await abrirFiltrado(page, 'http://127.0.0.1:8000/panel', {
      filtro: '#filtro',               // Selector del input de búsqueda
      valor: '11111111-1',             // RUT (o valor que reduce la tabla)
      selectorFilas: 'tr.fila',        // Selector de las filas de datos
    });
    // Ahora solo se ve una fila. Se graba normalmente.
    await page.click('a.ver');
  }
}
```

### Si necesitas código personalizado durante el filtrado

```js
await abrirFiltrado(page, baseURL + '/panel', {
  filtro: '#filtro',
  valor: '12345678-5',
  selectorFilas: 'tr.fila',
  alPintar: async () => {
    // Se ejecuta 3 veces: al tapar (antes de filtrar), al filtrar, y al destapar.
    // Útil para clickear botones o esperar cambios que no ocurren en la URL.
    await page.waitForTimeout(100);
  },
  esperaMs: 10000  // Timeout para que el filtro se aplique (defecto: 5000 ms)
});
```

### Menos común: tapar/destapar manualmente

Si **no** usas `abrirFiltrado` (porque la lógica es más rara), puedes hacerlo a mano:

```js
import { cubrir, descubrir } from 'demo-engine';

{
  hacer: async (page) => {
    await cubrir(page);                // Pantalla negra desde ahora
    await page.goto('/seccion-sensible');
    await page.fill('input[type=search]', 'filtro-valor');
    await page.click('button[type=submit]');
    await page.waitForTimeout(500);    // Espera a que el JavaScript filtre
    await descubrir(page);             // Ahora se ve
  }
}
```

**Importante:** `cubrir` cubre **toda la pantalla**, no un elemento suelto. Se repone si una navegación ocurre, y la altura es exactamente la del viewport (no hay overflow).

### Validación en tiempo de compilación

```js
// Esto aborta ANTES de grabar:
exigirEntornoDeDesarrollo(config.baseURL, process.env);
// Falla si:
// - No hay entorno declarado           ← el defecto, y el caso más común
// - CUALQUIERA de las dos, DEMO_ENTORNO o APP_ENV, dice 'production', 'staging', etc.
//   (declarar desarrollo en la otra NO lo tapa: la señal de producción manda)
// - El host es público (aunque el entorno diga 'local')
// Solo continúa si:
// - Al menos una de las dos está declarada, y NINGUNA de las declaradas dice otra cosa
//   que 'local', 'testing' o 'development'
//   Y el host es 127.x, 192.168.x, 10.x, 172.16-31.x, ::1, localhost, *.local, *.lan, *.test
// - O DEMO_FORZAR=1 (pero no lo hagas en producción)
```

La dirección **nunca autoriza**, solo puede negar: un `10.x` o un `localhost` pueden ser
producción perfectamente (en el despliegue por islas, dentro de la isla, `localhost:8031` ES
el sistema real). Por eso el permiso viene de una variable que alguien puso a propósito y el
comportamiento por omisión es no grabar.

