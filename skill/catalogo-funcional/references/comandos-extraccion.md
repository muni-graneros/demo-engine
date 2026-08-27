# Cheatsheet de extracción (Laravel + Filament)

Comandos concretos para levantar la fuente. En proyectos Docker, prefijá con
`docker exec <contenedor> php artisan …`. **Esto es la fuente, no el entregable**: el catálogo
final va en lenguaje de usuario, sin nada de esto.

## 1. Superficie y frentes
```bash
php artisan route:list --except-vendor          # rutas propias (público + panel + app + api)
php artisan route:list | grep -c 'GET\|POST'    # tamaño total
# Frentes: mirá los prefijos (/, /panel, /app, /api). Cada prefijo suele ser un frente.
ls app/Filament/*/Resources app/Filament/*/Pages app/Filament/*/Widgets
ls app/Livewire                                 # front público / app de terreno
```

## 2. Roles y alcance (Spatie / Filament Shield)
```bash
php artisan tinker --execute='
foreach(\Spatie\Permission\Models\Role::with("permissions")->get() as $r){
  $rec=$r->permissions->pluck("name")
    ->map(fn($p)=>preg_replace("/^(view_any|view|create|update|delete|delete_any|restore|force_delete|replicate|reorder|page)_?/","",$p))
    ->unique()->sort()->values();
  echo strtoupper($r->name)." (".$r->permissions->count()."): ".$rec->implode(", ")."\n\n";
}'
# usuario de cada rol:
php artisan tinker --execute='foreach(\Spatie\Permission\Models\Role::all() as $r){ echo $r->name." -> ".(\App\Models\User::role($r->name)->first()?->email??"?")."\n"; }'
```
Resumí por ÁREA (gestiona / ve / sin acceso), no permiso por permiso.

## 3. Flujos por recurso (acciones, filtros, estados, relation managers)
```bash
grep -roE "Action::make\('[a-z_]+'\)" app/Filament                 # acciones extra (exportar, ficha, etc.)
grep -roE "SelectFilter::make\('[a-z_]+'\)|Filter::make\('" app/Filament   # filtros
grep -rlE 'extends RelationManager' app/Filament                    # sub-recursos (una persona → sus X)
grep -rlE 'BulkAction' app/Filament                                 # acciones masivas
# estados: buscar los enums del dominio
grep -rhE 'case ' app/Enums/Estado*.php
```

## 4. Los mensajes que ve el usuario (ÉXITO y ERROR)
```bash
# Éxito (toasts al guardar/resolver):
grep -rniE "Notification::make|->success\(|->title\(|->body\(" app resources | grep -v test | head -40
# Textos en archivos de idioma:
ls lang/ 2>/dev/null; grep -rniE "'.*'\s*=>\s*'" lang/*/*.php 2>/dev/null | head
# Validación / negocio:
grep -rniE "->rules\(|'required'|messages\(\)|abort\(|throw new " app | grep -v test | head -30
# Reglas de negocio con mensaje propio (excepciones de dominio):
grep -rlE 'extends .*Exception' app | xargs grep -lE "getMessage|__construct.*string" 2>/dev/null
```
**Confirmá en vivo** el texto real (sección 7); no copies el del código sin verlo en pantalla.

## 5. Los documentos que genera (PDF, CSV, expediente, correos con adjunto)
```bash
grep -rniE "response\(\)->download|streamDownload|->stream\(|Content-Disposition" app | head
grep -rniE "Pdf::|->pdf\(|dompdf|snappy|Barryvdh" app composer.json | head       # PDFs
grep -rniE "Excel::|fromCollection|->csv|WriterEntityFactory|fputcsv" app | head  # planillas
grep -rniE "ExportAction|Exports\\\\|Tables\\\\Actions\\\\Export" app | head       # exportaciones Filament
grep -rniE "attach\(|attachData\(|->attach" app/Mail app/Notifications 2>/dev/null | head  # adjuntos de correo
```
Abrí al menos uno (descargándolo desde la UI) para describir qué contiene.

## 6. Lo que el sistema hace solo (agendado)
```bash
php artisan schedule:list          # crons: recordatorios, avisos, anonimización, respaldos
php artisan list | grep -viE 'make:|migrate|vendor'   # comandos de dominio
```

## 7. Verificar en vivo (mensajes y flujos reales)
Un script Playwright mínimo (guardar DENTRO del repo para que resuelva `playwright`):
```js
import { chromium } from 'playwright';
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
await page.goto('http://localhost:PUERTO/PANEL/login');
// Filament: los inputs usan wire:model, no name=; el login redirige por Livewire.
await page.fill('#form\\.email','usuario@dominio'); await page.fill('input[wire\\:model="data.password"]','password');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:8000}).catch(()=>{});
// hacer la acción y LEER el toast real:
const msg = await page.locator('.fi-no-notification').first().innerText().catch(()=>'(sin toast)');
console.log('MENSAJE:', msg);
await b.close();
```
- Mensaje de éxito: `.fi-no-notification` (toast de Filament).
- Permiso denegado: probar la URL con un rol limitado → leer el texto ("no está disponible para tu perfil").
- Validación: enviar un dato inválido (RUT malo, campo vacío) → leer el error del campo.

## 8. Datos ficticios (nunca PII real)
En los sistemas de Graneros:
```bash
php artisan demo:aislar-personas        # esconde reales (reversible, con seguro por archivo)
php artisan demo:sembrar-poblacion      # puebla ficticio (mapa/gráficos con datos)
# … documentar/grabar …
php artisan demo:sembrar-poblacion --limpiar
php artisan demo:aislar-personas --restaurar
```
En otros sistemas: `migrate:fresh --seed` en una base de prueba, o factories, o una copia
anonimizada. La regla es: **los datos que se ven en el manual/video son inventados**.
