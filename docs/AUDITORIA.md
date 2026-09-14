# Auditoría: `demo auditar`

`abrirFiltrado`/`abrirVerificado` protegen **durante la grabación**, pero dependen de que el
guion las llame — una auditoría real encontró que 4 de 10 guiones de un sistema en uso no lo
hacían, y dejaban varias personas a la vista. `demo auditar` verifica **el resultado**, no la
intención: mira lo que quedó en disco y busca datos a la vista, sin confiar en que el guion
hizo lo correcto.

Audita **dos cosas**, con el mismo criterio: el `.mp4` grabado Y las capturas que `demo
manual` incrusta en el `.md`/`.html`/`.pdf` (`capturas/*.png` dentro de `config.salida`). El
manual es un canal de fuga tan real como el video —una captura sin filtrar queda publicada
en el PDF igual que un frame sin filtrar queda en el MP4— y antes de esto quedaba
completamente fuera del portero automático: un guion descuidado (sin `abrirFiltrado`) podía
dejar una captura con varias personas a la vista incrustada en un manual publicado sin que
nada la detectara.

### Cómo funciona

**Video:**
1. Muestrea frames del MP4 con ffmpeg (el mismo binario estático que ya trae el motor), uno
   cada `auditoria.cada` segundos, hasta `auditoria.maximo` frames — pero **siempre al menos
   uno** si el video tiene contenido: con un video más corto que `auditoria.cada` (un guion de
   una sola escena, por ejemplo), el paso efectivo se recorta a la duración real para que el
   primer frame (segundo 0) nunca se pierda. Sin esto, `fps=1/cada` de ffmpeg no entregaba
   ningún frame y el comando "aprobaba" sin haber mirado nada.
2. Manda cada frame al servicio OCR configurado en `auditoria.ocr`.
3. Cuenta cuántos identificadores **distintos** matchean `auditoria.patron` en el texto que
   devolvió el OCR. **Más de uno en el mismo frame significa que había una lista sin
   filtrar** — la misma fuga que `abrirFiltrado` existe para evitar.

**El patrón por defecto está ANCLADO (desde v1.1.1).** Antes no lo estaba, y eso era un
defecto de exactitud confirmado por una revisión de seguridad: `\d{7,8}-[\dkK]` sin anclar
muerde **dentro** de cadenas más largas en vez de exigir un identificador completo. Dos
casos reales:

```
"9918039759-0"        (número de 10 dígitos) → sin anclar extrae "18039759-0", que además
                       VALIDA como RUT real: un identificador fantasma.
"Folio 12345678-2024" → sin anclar extrae "12345678-2" (el validador de dígito verificador
                       lo descarta después, pero ya se había extraído).
```

El daño va en las dos direcciones: un identificador fantasma marca **de más** (y un
control que grita en falso termina desactivado); y dos cadenas largas **distintas** que
comparten la cola (`9918039759-0` y `5518039759-0`, por ejemplo) colapsan en el **mismo**
identificador extraído, marcando **de menos** — justo lo que este control existe para
evitar. El patrón por defecto ahora exige que no haya otro dígito (ni un guion) inmediatamente
antes del identificador, ni otro dígito (ni `k`/`K`) inmediatamente después.

Si el video no tiene contenido examinable (duración cero, corrupto), no hay frames que
muestrear. Eso **nunca** se reporta como "0 de 0 sospechosos": `demo auditar` corta con un
mensaje explícito y código de salida distinto de cero — un resultado "0 de 0" sería
indistinguible de una auditoría real que sí miró y no encontró nada.

**Capturas del manual:** mismo paso 2 y 3 de arriba, pero SIN muestreo — a diferencia del
video (una corriente continua de la que conviene recortar solo cada tantos segundos), cada
paso del guion ya deja UNA sola captura, así que se audita cada PNG que haya en
`capturas/`. Si una captura resulta sospechosa, no hace falta guardar una copia aparte: la
imagen ya vive en disco (es la misma que embebe el manual), así que es su propia evidencia.

No hace falta que el OCR lea bien el texto: está afinado para cédulas, no para interfaces
web, y en la práctica **lee mal algún carácter pero mantiene el patrón intacto** (verificado
a mano: leyó `12145678-5` donde decía `12345678-5` — un dígito mal, el patrón sigue
matcheando). Por eso alcanza con contar coincidencias del patrón.

### Configuración (`demo.config.mjs`)

```js
export default {
  // ...
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',                  // endpoint del servicio OCR, SIN VALOR POR DEFECTO
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',  // qué cuenta como identificador (regex, sin flags; anclado desde v1.1.1)
    cada: 10,                                          // un frame cada N segundos
    maximo: 20,                                        // tope de frames por video
  },
};
```

**Compatibilidad (v1.1.1):** el patrón por defecto cambió (ver arriba). Esto es un arreglo
de exactitud, no un cambio de comportamiento declarado — pero cambia lo que se detecta. Un
sistema que hoy pasa `demo auditar` limpio podría empezar a marcarse (si dependía, sin
saberlo, de que un identificador fantasma quedara agrupado con otro y no superara el
umbral de "más de uno"); y al revés, un sistema con dos identificadores largos que
compartían cola y colapsaban en uno solo ahora los verá contados como corresponde. Si se
depende del comportamiento viejo (sin anclar) por algún motivo, `auditoria.patron` sigue
siendo 100% configurable: basta con declarar `'\\d{7,8}-[\\dkK]'` explícitamente.

**`auditoria.ocr` no tiene valor por defecto, a propósito:** es un host al que el proceso se
conecta, y esa decisión le corresponde a quien configura el sistema, no al motor genérico —
igual que `baseURL`. El motor tampoco sabe de RUT chilenos: `patron` es un regex de config,
no lógica hardcodeada; el valor de arriba es solo un defecto razonable para RUT, totalmente
reemplazable. Sin `auditoria.ocr`, `demo auditar` falla con un mensaje que dice exactamente
qué falta (no un `ECONNREFUSED` críptico contra `null`).

El servicio OCR debe aceptar `POST` con el archivo en un campo `file` (`multipart/form-data`)
y responder `{ text: "..." }`.

### Validación de identificadores (`auditoria.validar`)

**El problema, diagnosticado con un caso real.** `demo auditar` cuenta identificadores
DISTINTOS que matchean `auditoria.patron`; más de uno en una pantalla es la señal de una
lista sin filtrar. Corrido sobre el curso real de un sistema en producción, marcó una
captura como sospechosa:

```
[SOSPECHOSO CAPTURA] 2 identificadores distintos (16030759-0, 18023759-0)
```

Era un **falso positivo**: la pantalla mostraba una sola persona, con la tabla correctamente
filtrada a un resultado. Su RUT real (`18039759-0`) aparecía **tres veces** en pantalla —en
el buscador, en el chip de filtro activo, y en la celda de la tabla— y el OCR, que está
afinado para cédulas y no para texto de interfaz, lo transcribió mal en dos de esas tres
lecturas. Las dos cadenas "distintas" eran lecturas erróneas del **mismo** identificador, no
dos personas.

**Por qué esto importa más que un aviso molesto:** un portero que grita en falso termina
desactivado, y entonces no protege nada.

**La solución: `auditoria.validar` es una función OPCIONAL que descarta coincidencias del
patrón que no son un identificador real.** El RUT chileno trae dígito verificador (módulo
11); una lectura errónea del OCR casi nunca lo satisface por casualidad:

```
18039759-0   RUT VÁLIDO      ← el real
16030759-0   inválido        ← lectura errónea del OCR
18023759-0   inválido        ← lectura errónea del OCR
```

```js
// demo.config.mjs
function validarRut(id) {
  const limpio = id.toUpperCase();
  const [cuerpo, dv] = limpio.split('-');
  if (!cuerpo || !dv) return false;

  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === dvEsperado;
}

export default {
  // ...
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',
    validar: validarRut,
  },
};
```

Con `validar` declarado, `contarIdentificadores` llama a esa función por cada coincidencia
del patrón y descarta las que no aprueba; un frame o captura donde todas menos una resultan
inválidas queda con **un solo** identificador real, y ya no se marca como sospechoso.
**Sin `validar`, el comportamiento no cambia**: se sigue contando todo lo que matchea
`patron`, exactamente como hasta ahora — es puramente opt-in.

**El motor sigue sin saber qué es un RUT.** `validarRut` de arriba no vive en el motor: es
un ejemplo para `demo.config.mjs` de cada sistema consumidor, igual que `patron` u `ocr`.
Cualquier otro identificador (RFC mexicano, DNI argentino, un ID interno con su propio
checksum) se resuelve con la misma idea: una función `(id: string) => boolean` que solo
quien configura el sistema puede escribir, porque solo esa persona sabe qué hace válido a
su identificador.

**El límite honesto: esto reduce mucho los falsos positivos, no los elimina.** Una lectura
errónea del OCR puede, por pura casualidad, caer en un identificador con dígito verificador
correcto — con un solo dígito de control eso pasa aproximadamente 1 de cada 11 veces. Frente
a "toda coincidencia del patrón cuenta", que es 100% de las lecturas erróneas, la mejora es
grande mientras `patron` produzca varios candidatos por pantalla (el caso real de arriba). No
es una garantía criptográfica: es un filtro de forma, igual que `patron` lo es, solo que un
paso más estricto.

Si `validar` lanza una excepción, `demo auditar` falla con un mensaje que dice qué
identificador estaba validando y el motivo — no se traga el error en silencio.

### Salida

```
[SOSPECHOSO] segundo 40s — 2 identificadores distintos (12345678-5, 87654321-0) — frame guardado en: docs/manual/auditoria/panel/frame-0005.png
[SOSPECHOSO CAPTURA] 2 identificadores distintos (12345678-5, 87654321-0) — imagen: docs/manual/capturas/panel-3.png

docs/manual/panel.mp4: 1 de 12 frames sospechosos.
docs/manual/capturas: 1 de 4 capturas sospechosas.
```

Cada frame sospechoso del video queda **guardado en disco** (`config.salida/auditoria/[guion]/`)
junto con el segundo exacto en que apareció; cada captura sospechosa YA vive en disco (es la
misma imagen que embebe el manual) — un aviso que no se puede inspeccionar no sirve de nada.
El comando termina con código de salida **distinto de cero** si encontró algo en cualquiera de
los dos (video o capturas), para poder usarlo como gate en CI.

### Capturas: se limpian al empezar cada corrida

`demo grabar`/`demo curso`/`demo manual` limpian `capturas/` (dentro de `config.salida`) ANTES
de grabar nada, igual que ya se hace con los directorios temporales del montaje (`.tmp`,
`.tmp-curso`). Sin esto, una captura sin filtrar que dejó una corrida vieja sobrevive
indefinidamente en un directorio que termina incrustado en el manual publicado — nadie la
vuelve a mirar una vez que el video de esa corrida ya está aprobado.

