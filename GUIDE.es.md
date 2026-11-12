# Downbeat — Guía / FAQ

## Qué hace

Downbeat escucha un clip de audio seleccionado en Premiere Pro, o una capa
de audio en After Effects (música o efectos de sonido). Encuentra el tempo
y los tiempos, coloca marcadores donde cortar y detecta la tonalidad.
Todo se ejecuta en tu equipo: nunca se sube nada.

Necesita Premiere Pro 2025 (25.0) o After Effects 2025 (25.0) o posterior
(probado en 2026), en macOS 13.5 o posterior (Apple Silicon o Intel) o
Windows 10 u 11 (x64). Windows en ARM aún no es compatible.

## Flujo de trabajo habitual

1. Selecciona un clip de audio en la línea de tiempo de Premiere.
2. Pestaña **Analizar** → **Analizar audio seleccionado**. Encuentra el
   BPM, los tiempos y los tiempos fuertes (el «uno» de cada compás). Aún
   no coloca nada en la línea de tiempo: solo calcula.
3. Comprueba los tiempos fuertes de oído: reproduce la vista previa (▶
   bajo la forma de onda; suena un clic en cada tiempo fuerte). Si el
   «uno» cae en el tiempo equivocado, muévelo con **El «uno» es el tiempo
   1 2 3 4**: pulsa el tiempo que de verdad es el «uno».
4. **Colocar marcadores**: el único botón que escribe marcadores de
   verdad. **Dónde** elige a dónde van:
   - **Clip**: se quedan con el audio cuando mueves o recortas el clip.
     (Pertenecen al archivo de medios, así que cada uso de ese archivo en
     el proyecto los muestra.)
   - **Línea de tiempo**: marcadores de secuencia en la regla de la línea
     de tiempo, sobre el clip. Se quedan en su sitio cuando mueves el
     clip.

   Colocar de nuevo —o elegir otro tiempo como «uno» después de colocar,
   o cambiar entre el clip y la línea de tiempo— sustituye los marcadores
   anteriores de Downbeat en vez de añadir un segundo juego. Solo se
   sustituye el juego colocado para este clip: los marcadores de Downbeat de
   otro clip se quedan, también donde los dos clips se solapan, después de
   mover, recortar o cortar un clip, y después de Edición → Deshacer. Los
   marcadores que añadiste tú nunca se tocan, aunque se llamen D o b. Un
   marcador de Downbeat al que le cambias el comentario o la duración (en
   After Effects, también el color) pasa a ser tuyo. After Effects admite
   un solo marcador por instante, así que un tiempo que cae justo sobre
   uno de tus marcadores se omite allí (el registro lo cuenta). Para
   empezar de cero, **Borrar** quita los marcadores de Downbeat del clip
   —de cada trozo después de un corte, sea cual sea el trozo seleccionado— y
   deja los tuyos y los de otros clips.
5. Corta en los marcadores en Premiere: con el ajuste activado (S), la
   herramienta Cuchilla (C) se ajusta a los marcadores. Cada marcador está
   al inicio del fotograma de vídeo en el que empieza su tiempo, así que
   un corte cae en el tiempo o justo antes, nunca después. (After
   Effects: ver más abajo.)

## La pestaña Analizar

Secciones numeradas, de arriba abajo:

- **01 / Clip**: **Analizar audio seleccionado**, luego la forma de onda
  con los tiempos fuertes, ▶ para escuchar y el clic en los tiempos
  fuertes. Tras un análisis, el botón pasa a ser un pequeño enlace
  «analizar de nuevo». Cuando el
  nombre del archivo indica que es un videoclip («Official Music Video»,
  «MV»…), una nota bajo el clip pide revisar los marcadores de la intro y
  del final: los videoclips suelen tener diálogos o efectos de sonido ahí.
  La canción en sí se analiza como cualquier pista, y los vídeos con
  letra y las subidas «Official Audio» no reciben la nota. Cuando algo no
  se puede hacer, la línea con el nombre del clip dice por qué, completo,
  hasta tu siguiente clic, tecla o selección: por ejemplo, cuando
  **Colocar marcadores** no tiene ningún tiempo dentro del clip, o el clip
  no tiene un archivo de audio propio (una secuencia anidada, una
  multicámara o un clip combinado). El audio de menos de 2 segundos, o en
  silencio, también se rechaza ahí en vez de recibir una cuadrícula
  inventada. Los detalles técnicos van al registro (Ajustes → Diagnóstico →
  Copiar registro).
- **02 / Tempo**: de arriba abajo, una línea por etiqueta:
  - el **BPM** que encontró el análisis, en letra grande; si el clip se
    reproduce a una velocidad distinta del 100 %, una línea bajo él da el
    tempo tal como suena en la línea de tiempo (BPM × velocidad);
  - **BPM propio**: escribe un tempo y pulsa **Usar** para colocar en su
    lugar una cuadrícula exactamente regular (**Deshacer** devuelve el
    análisis). La cuadrícula se cuenta desde el inicio del clip: ahí caen
    un tiempo y un «uno». También llega hacia atrás hasta el inicio del
    archivo, y cuando alargas el clip sigue al mismo tempo, así que un
    recorte posterior mantiene la misma cuadrícula. La línea del clip
    muestra entonces ese BPM;
  - **Mitad / doble**: **½×** o **2×** cuando el tempo salió a la mitad
    o al doble del real. Sobre una cuadrícula **Afinada** el resultado es
    una **Básica** (la línea **Cuadrícula** marca Básica); el clic contrario
    devuelve la Afinada. El BPM mostrado y guardado sigue el cambio;
  - **Cuadrícula: Afinada / Básica**: aparece cuando se ejecutó el
    segundo detector o podría ayudar; ver «Segundo detector de tiempos»
    más abajo;
  - **El «uno» es el tiempo 1 2 3 4** elige qué tiempo cuenta como el
    primero del compás cuando el análisis eligió mal: 1 es donde lo puso
    el análisis (y lo devuelve ahí); 2, 3 o 4 mueven el «uno» a ese
    tiempo. Un clic aquí o en **Desplazar** justo cuando se selecciona otro
    clip se rechaza («El clip seleccionado cambió»): selecciona el clip y
    pulsa otra vez.
- **03 / Marcadores**: **Tipo**: **Compases** pone un marcador en el
  «uno» de cada compás; **Compases + tiempos** añade también los demás
  tiempos del compás, y el «uno» de cada compás sigue siendo tiempo
  fuerte. **Dónde**: Clip o Línea de tiempo.
  **Precisión** (Premiere): Fotograma o Exacto (ver abajo). Con Exacto,
  **Desplazar − / +** mueve todos los marcadores de esta pista 1 ms antes
  o después por clic, para una pista cuyos marcadores quedan todos un poco
  antes o después de los golpes; los marcadores ya colocados se mueven al
  momento, y el desplazamiento se recuerda para esa pista (hasta ±30 ms).
- Abajo, **Colocar marcadores**, **Borrar** y **Más** (copiar / pegar
  marcadores).
- **Añadir pista de metrónomo** (bajo esos botones) crea una pista de clics a
  partir de la cuadrícula actual: un WAV mono de 44,1 kHz con todos los
  tiempos y un acento en cada «uno», según tu «uno», los ajustes de la
  cuadrícula y el recorte y la velocidad del clip. Empieza con la música, no
  en el cursor, y va debajo de ella: en Premiere, en una pista de audio
  bajo la música que no esté bloqueada ni silenciada y tenga sitio para
  todo el WAV (añade una pista si
  no hay ninguna libre); en After Effects, en una capa nueva justo debajo de
  la capa de la música. La música se sigue oyendo. Dónde se guarda el WAV se
  elige en **Ajustes → Audio terminado**; si no se puede insertar, la línea
  junto al botón muestra dónde se guardó. Hasta 30 minutos.

**Análisis guardados.** Cada análisis se guarda junto con el tamaño y la fecha
del archivo. Si sustituyes el archivo, se analiza de nuevo; si el archivo
cambia mientras se analiza, el resultado se descarta. Una entrada guardada
cuyos datos de tiempos no sirven conserva su tonalidad, y su cuadrícula
necesita un nuevo Analizar. Una corrección de tempo (**½×**, **2×**,
**Afinada**) que sigue en marcha cuando eliges otro clip o empiezas otro
análisis se descarta, así que nunca sustituye a la cuadrícula más nueva.
Si en la misma sesión vuelves a seleccionar un clip del mismo archivo —tras
un recorte o después de otro clip—, vuelve la cuadrícula que tenías: el
«uno» elegido, **BPM propio** con su **Deshacer**, y **Básica** o
**Afinada** (Básica al instante, sin un análisis nuevo). El panel lo
recuerda para los últimos 12 archivos. Tras reiniciar el programa, y con
una canción analizada en el otro programa, al seleccionar el clip vuelven
su tempo y su cuadrícula guardados; cambiar entre **Básica** y **Afinada**
analiza antes el clip de nuevo.

## Segundo detector de tiempos (Beat This!)

Cada análisis ejecuta dos detectores de tiempos sobre el mismo audio: el
algoritmo habitual y después un pequeño modelo de IA local (Beat This!),
que suele encontrar mejor cuál es el tiempo «uno». El resultado del
modelo solo se usa si pasa unas comprobaciones frente al primero (por
ejemplo, no debe oír la pista a la mitad o al doble de velocidad); si no,
se queda el resultado habitual. Añade unos segundos por pista. El BPM se
mide a partir de los tiempos que usan los marcadores, así que coincide con
ellos; cambiar la **Cuadrícula** puede moverlo unas décimas.

**Tempo → Cuadrícula** muestra qué resultado se usa: **Afinada** (se
aplicó el segundo detector) o **Básica** (solo el resultado habitual).
Escucha los marcadores: si no caen en los tiempos, pulsa la otra palabra.
Básica vuelve al instante; Afinada ejecuta de nuevo el segundo detector
(unos segundos). Si el segundo detector no termina, se queda Básica, la
línea **Cuadrícula** lo indica y un clic en **Afinada** lo intenta otra vez.

En una pista difícil de leer, la línea bajo **Cuadrícula** lo indica y
sugiere **Afinada**, que ahí suele ser más precisa.

Con **Afinada**, el segundo detector también coloca el «uno» de cada
compás. Cuenta los compases en toda la canción a la vez, así que el «uno»
llega cada cuatro tiempos y no salta a un tercer tiempo fuerte. Las
canciones en 6/8 o 12/8 también se cuentan de cuatro en cuatro. Si sus
tiempos no pasan las comprobaciones y se queda la cuadrícula habitual (la
línea **Cuadrícula** no aparece entonces), cuenta igualmente los compases,
sobre los tiempos habituales. Si el
detector no está seguro de dónde empiezan los compases, un aviso bajo
**El «uno» es el tiempo** lo indica: escucha el clic y, si el «uno» no cae
bien, pulsa en **1 2 3 4** el tiempo que de verdad es el «uno», o cambia la
**Cuadrícula** a **Básica**.

## Tipos de marcador

Cada marcador tiene un color y una etiqueta según su función:

| Etiqueta | Significado | Color en Premiere |
|---|---|---|
| D | Tiempo fuerte: el «uno» de un compás | Verde |
| b | Tiempo normal (Tipo: Compases + tiempos) | Azul |

Cada marcador lleva también una breve explicación (visible en el panel
Marcadores de Premiere). Qué tipos obtienes lo decide **Tipo** (Compases
o Compases + tiempos).

## Herramientas de marcadores

**Más**, abajo en la pestaña Analizar, abre **copiar y pegar**
marcadores entre clips (ver abajo).

## Vista previa con clic en los tiempos

Tras el análisis aparece una pequeña vista previa de la forma de onda con
un botón de reproducción y un clic en cada tiempo fuerte, para comprobar
la detección de oído antes de colocar o cortar nada. Desplaza para mover
la vista, Alt (Opción en Mac) + desplazamiento para hacer zoom, o usa los
botones +/−/Ajustar. Pista y Clic tienen controles de volumen separados.
Elegir un «uno», **Desplazar** o recortar el clip no detiene la reproducción
ni cambia el zoom.

## Detectar tonalidad

Funciona independientemente del análisis. Primero elige **Música** o
**Efecto de sonido**: necesitan ajustes de análisis distintos, y cada uno
guarda su propio resultado para un archivo. El
resultado se muestra en la rueda Camelot y en notación tradicional, con
las tonalidades que combinan bien con él.

**Analizar: Archivo completo / Clip seleccionado** elige qué se mide: todo el
archivo o solo la parte que usa el clip seleccionado (entre su entrada y su
salida). Otro recorte tiene su propio resultado (se guardan las últimas 12
partes de un archivo; una tonalidad fijada a mano para una parte se guarda
siempre). El análisis de tiempos y la vista previa no cambian. Una parte muy corta, o una en la que la música cambia
de tonalidad, puede dar una tonalidad poco fiable.

Bajo el resultado, una línea indica cuánto fiarse. En modo **Música**
opinan tres análisis independientes: los perfiles clásicos de
tonalidad, la progresión de acordes y un pequeño modelo de IA (S-KEY);
si los dos últimos coinciden contra el primero, gana su respuesta.
Cuando coinciden los tres, la tonalidad es fiable; cuando coinciden dos
o ninguno, escucha antes de fiarte. En música de dos minutos o más, la
progresión de acordes solo se lee cuando las otras dos opiniones difieren
(si coinciden, no cambiaría la respuesta), y entonces la línea habla de dos
opiniones. En modo **Efecto de sonido** el
análisis está ajustado para sonidos y no para canciones: una ventana de
análisis más larga que oye mejor las notas graves, y sin modelo de IA
(está entrenado con música y aquí funciona peor). La segunda opinión es
la progresión de acordes. Los sonidos de menos de 10 segundos reciben una
nota que lo indica: con tan poco audio la tonalidad es menos fiable. Si
ya conoces la tonalidad, puedes fijarla a mano (**Ajustar tonalidad del original**):
escribe su código Camelot, como 8A u 11B (cualquier otra cosa muestra una
breve pista). Se guarda para ese archivo y esa parte; **Usar tonalidad detectada**, junto a
**Detectar tonalidad**, recupera la tonalidad detectada. Sustituir el archivo
de audio borra su análisis y la tonalidad fijada a mano.

**Cambio de tono** (bajo el resultado): elige la tonalidad en la que está
un sonido y la tonalidad que quieres, y te da los números para tu propio
plugin de cambio de tono —semitonos, cents y porcentaje de velocidad— y avisa
cuando un destino no se puede alcanzar, por ejemplo de menor a mayor.
**Cambiar el tono del clip** lo hace por ti,
igual que cambia el tono la vista previa de la biblioteca (como un
sampler: más agudo también suena más rápido y más corto): coloca el
propio archivo del clip seleccionado, la parte que usa la línea de
tiempo, en una pista libre (nunca una bloqueada o silenciada, y un clip
estéreo nunca en una pista mono o 5.1) en el lugar
del clip, a la velocidad que da
ese cambio; no se crea ninguna copia, sigue siendo tu archivo donde
está. El original se queda donde estaba, desactivado (Desactivar en
Premiere, sin sonido en After Effects): vuelve a activarlo para
deshacerlo. Un clip que ya está desactivado se rechaza: puede que aún suene
una copia anterior con el tono cambiado, así que selecciona el clip que
suena. En Premiere solo entra el sonido, nunca la imagen del archivo; un
archivo con varios canales mono necesita una pista libre para cada uno,
cada parte recibe la nueva velocidad, y los demás canales del original se
desactivan con él (nunca se eliminan).

**Cambiar el tono del clip** está junto a los números de semitonos / cents /
velocidad (debajo de ellos en un panel estrecho). Cada cambio se suma a la
velocidad actual del clip: +2 y luego otros +2 dan 125,99 %, y volver a la
tonalidad original devuelve el 100 %. Se muestra la velocidad final del
clip, y la línea de BPM va del tempo actual al nuevo. Si la selección o la
velocidad cambian antes de pulsar, revisa los números nuevos y pulsa otra
vez (mover el clip, o añadir una capa encima, no cuenta como cambio).
Después queda seleccionado el clip (capa) nuevo, así que el siguiente
**Detectar tonalidad** oye su velocidad; si la aplicación no puede
seleccionarlo, el panel te pide que lo hagas. Con **Analizar: Clip
seleccionado**, conserva la tonalidad de esa parte. El clip nuevo empieza sin
marcadores de Downbeat: colócalos de nuevo para su velocidad. Tus
marcadores pasan a él, en el mismo punto del sonido; el clip original
conserva los suyos. Los marcadores de línea de tiempo de Downbeat colocados
para el original pasan a ser del clip nuevo: **Colocar marcadores** o
**Borrar** en él sustituye todo ese juego, incluso los marcadores que quedan
después del final del clip nuevo si es más corto. En Premiere el clip nuevo
tiene su propio elemento de proyecto, así que borrar sus marcadores no toca
el original. Un cambio de tono rechazado no deja ningún elemento sin usar en
el proyecto.

**Tonalidad del original** es lo que Detectar tonalidad midió en el propio
archivo (o en la parte elegida); no cambia con la velocidad: un archivo en
la menor sigue siendo 8A. **Tonalidad en la línea de tiempo (calculada)** es
la tonalidad en la que suena el clip a su velocidad actual (el mismo
archivo a +2 semitonos suena en si menor, 10A), y es el resultado
principal: la rueda, las tonalidades compatibles, **Como el clip** y **En
tono** la siguen, y se actualiza cuando cambia la velocidad del clip. Con
velocidades distintas del 100 %, una línea adicional explica el cambio (por
ejemplo «5A, +3 semitonos»). Una velocidad entre semitonos enteros no tiene
una tonalidad Camelot exacta, así que no se puede emparejar ni cambiar de
tono automáticamente. Los efectos de audio, el estiramiento que conserva el
tono y Maintain Audio Pitch de Premiere no entran en este cálculo.

## Pestaña Biblioteca: Música y SFX

Añade carpetas de audio, o una unidad entera, una tarjeta de memoria o una carpeta de red; solo el disco del sistema no se puede añadir entero. Las carpetas de Música y SFX no deben solaparse; si una carpeta está en las dos de todos modos, sus archivos aparecen en una sola sección y el panel lo indica (no se elimina nada). Un escaneo se salta las carpetas de papelera y de instantáneas del sistema y de las unidades de red (`$RECYCLE.BIN`, `System Volume Information`, `#recycle`, `@Recycle`, `@eaDir`, `#snapshot` y similares), así que un sonido eliminado no vuelve como sonido de la Biblioteca. Un escaneo cuenta hasta 50.000 archivos; si hay más, añade carpetas más pequeñas. El siguiente Iniciar análisis vuelve a intentar los archivos con errores, y una carpeta que no se pudo leer conserva los registros que ya tenía. Si sustituyes un archivo en la misma ruta, su vista previa se vuelve a leer antes de insertarlo.

Dos secciones, **Música** y **SFX**, cada una construida a partir de
carpetas de tu equipo.

- **+ Carpeta** una vez por carpeta (se incluyen las subcarpetas). Los
  archivos de audio de la carpeta (wav, aiff, mp3, m4a, aac, flac, ogg)
  aparecen al momento como «pendiente de análisis»; aún no se ejecuta
  nada pesado, así que puedes añadir varias carpetas primero.
- **Iniciar análisis (N)** analiza los N archivos pendientes. Cada
  archivo se analiza una vez; más adelante, Iniciar análisis también
  encuentra archivos nuevos o cambiados en las carpetas y analiza solo
  esos. Los efectos de sonido cortos pasan rápido, y la música más
  despacio (se analizan varias a la vez).
- **Se usan las tonalidades y tempos de los nombres de archivo.** Muchos
  packs de samples los indican («Key C#min», «F# minor», «120bpm», «8A -
  128 - …», tonalidad Camelot y tempo). Lo que dice el nombre gana a la detección, y
  un archivo cuyo nombre da todo lo necesario (la tonalidad, y para la
  música también el tempo) no se analiza en absoluto. Un nombre que solo
  da la nota base justo al lado de su marca de BPM («Loopable D_90 bpm»), o
  una carpeta con el nombre de una nota, conserva esa nota y toma
  mayor/menor del análisis. Una carpeta llamada solo «A» a «G» cuenta solo
  cuando las carpetas de al lado también son notas y alguna lleva
  sostenido, bemol o modo (A, A#, B, C…), como en un pack ordenado por
  notas y no en una biblioteca ordenada por la primera letra. La nota de
  una carpeta nunca da tonalidad a un sonido sin tono definido. Esos
  valores aparecen marcados «del nombre del archivo» en la lista. Las
  formas cortas como «Am» solo cuentan en un sitio inequívoco («_Am_»,
  «(Am)», o justo al lado de la marca de BPM: «Loop 120bpm Am»), porque en
  texto normal suelen ser palabras: un título como «Am I Ready Yet 120 BPM» se
  analiza.
- **Cuánta seguridad tiene una tonalidad de música.** La tonalidad sale de tres
  métodos. La fila dice «tonalidad confirmada» si al menos dos la dieron, y
  «tonalidad incierta» (en rojo) si los tres difieren; esas conviene
  comprobarlas de oído. Una tonalidad tomada del nombre del archivo y los
  efectos de sonido no muestran esa palabra.
- Mientras se ejecuta un análisis, una ventana cubre el panel —usa toda la
  potencia del equipo— y muestra el progreso, el tiempo restante y
  **Cancelar**. Los archivos analizados hasta ese momento se conservan, e
  Iniciar análisis continúa con el resto.
- Las carpetas se muestran como un árbol, con el número de archivos de
  cada una; la flecha pequeña abre las subcarpetas. Con más de tres
  carpetas, el árbol se pliega en una línea «▸ Carpetas (N)»; púlsala
  para abrirlo o cerrarlo. La × junto a una carpeta la quita de la
  biblioteca; los archivos en sí nunca se tocan.
- **Elegir dónde buscar.** El cuadrado a la izquierda de
  una carpeta la incluye en la búsqueda: cuando hay algún cuadrado
  activado, la lista y la búsqueda muestran solo los archivos de esas
  carpetas (y sus subcarpetas). Puedes activar varios a la vez, por
  ejemplo dos packs de diez. Un clic en el nombre de una carpeta muestra
  solo esa carpeta; pulsa de nuevo, o **Todas las carpetas**, para verlo
  todo. La línea plegada indica entonces lo elegido («Carpetas (3) · Airy
  Pack»), y **Restablecer** también lo quita. La elección se recuerda, por
  separado para Música y SFX.
- **Archivos que ya no están.** La biblioteca guarda dónde está cada
  sonido en tu equipo; nunca lo copia. Un archivo que se movió, se
  renombró o se eliminó, o que está en un disco no conectado, aparece como
  **archivo no encontrado** (atenuado, sin Escuchar ni Insertar), y una
  carpeta añadida que no está muestra «— no encontrada» en el árbol.
  Cuando el disco vuelve a estar conectado, todo regresa solo, con su
  análisis y sus favoritos; el panel lo nota cuando vuelves a hacer clic en
  el panel o en una fila atenuada. Iniciar análisis nunca quita los
  sonidos de una carpeta que falta: sus archivos esperan, y el panel dice
  cuántos. Solo quita los archivos que ya no están en una carpeta
  disponible, e incluso entonces conserva un sonido con estrella o con una
  tonalidad fijada a mano (mostrado como **archivo no encontrado**) hasta
  que le quites la estrella (uno con tonalidad fijada a mano, hasta que
  quites su carpeta con ×). Un archivo movido a otro sitio de la misma
  sección, con el mismo nombre, tamaño y fecha, conserva su análisis y su
  estrella. Para quitar una carpeta del todo, usa su ×.

Para encontrar algo:

- **Buscar**: busca en los nombres de archivos y de carpetas, al inicio
  de las palabras («hit» encuentra «Big Hit», no «white»; «trac» encuentra
  «Tractor»). Cada palabra que escribas debe coincidir. Las palabras con
  guion o apóstrofo («sci-fi», «sub-drop», «don't») y los nombres con
  tildes se encuentran tal como los escribes. Una búsqueda por nombre
  también muestra los sonidos que aún esperan análisis o que no se
  pudieron leer (un filtro de tonalidad o de BPM necesita un análisis).
  También conoce
  sinónimos de efectos de sonido y categorías de sonido: **swoosh** también
  encuentra archivos whoosh, swish y fly-by, **hit** también impact, punch
  y thud (y las categorías de impactos de UCS), **riser** también uplifter
  y build-up. Pon un signo menos delante
  de una palabra para excluirla: **whoosh -fire**. Los archivos cuyos
  nombres coinciden mejor van primero. Escribir el nombre de una carpeta
  encuentra los archivos que contiene (y los de sus subcarpetas). A la
  derecha del campo **Buscar**, el panel muestra las otras palabras que
  también busca («+ uplifter, swell»); la **✕** tras ellas busca solo las
  palabras que escribiste, y **+ sinónimos** las vuelve a activar (se
  recuerda).
- Muchas bibliotecas comerciales nombran los archivos según el Universal
  Category System (UCS), por ejemplo «DSGNWhsh_Airy Pass_Example
  Audio_Airy Pack.wav»: categoría DESIGNED / WHOOSH, del pack Airy Pack
  de Example Audio. La búsqueda encuentra esos archivos también por su
  categoría, aunque la parte del nombre no la diga, y por creador o pack
  («example audio», «airy pack»). Con el panel en ruso o en español, una
  búsqueda en ese idioma encuentra los archivos con nombre en inglés
  (gracias a las traducciones propias de UCS).
- **Tonalidad**: la tonalidad Camelot, exacta o **+ compatibles** (la
  misma tonalidad, sus vecinas en la rueda y su relativa mayor/menor).
- **BPM** (Música): un tempo y cuánto puede desviarse (±%). «también ½×
  y 2×» encuentra también archivos a la mitad o al doble de ese tempo, que
  suelen montarse bien juntos.
- **Como el clip** (un botón) rellena la tonalidad
  y el BPM del clip seleccionado, calculados a partir del análisis guardado
  del original y la velocidad actual, para encontrar sonidos compatibles.
  Cuando el clip seleccionado no tiene tonalidad ni tempo (otro clip, o
  ninguno), Como el clip se desactiva y dice por qué. **Restablecer** quita todos los
  filtros.
- **Orden**: mejor coincidencia, nombre, duración o tempo (Música).
- **★** en una fila lo marca como favorito; **Favoritos** muestra solo tus
  favoritos. Los favoritos se guardan con la biblioteca.
- **Con tono** (SFX) oculta los sonidos que muestran «sin tono definido».

Las mejores coincidencias van primero. La lista muestra los primeros 300
archivos, y **Mostrar 300 más** abajo añade los siguientes; cuando eliges
una tonalidad, muestra todas las coincidencias (hasta 3.000). Un clic en
una fila elige el archivo; **Espacio** lo escucha e **Intro** lo inserta,
en cualquier fila mostrada, como **Insertar**.
Pulsa ▶ para escuchar. **Insertar** (o
un doble clic en la fila) pone el archivo en la línea de tiempo en el
cursor, una vez por doble clic; un doble clic en ▶ o ★ nunca inserta. En
Premiere va a la primera pista de audio que esté libre durante todo el
sonido, no esté bloqueada ni silenciada y admita sus canales (un sonido
estéreo se salta las pistas mono y 5.1) —no se sobrescribe nada; si no
hay una pista así, lo
dice—, y en After Effects como una capa nueva en el tiempo actual. El
archivo se importa una vez a una bandeja «Downbeat» (carpeta, en After
Effects) y después se reutiliza. En Premiere, los puntos de entrada y salida
que pusiste a ese sonido en la bandeja quedan como estaban después de una
inserción, y una inserción del sonido entero coloca el sonido entero, no
solo de tu entrada a tu salida. Los archivos FLAC y OGG se pueden escuchar
pero no insertar: Premiere Pro y After Effects no los importan, y el panel lo
dice; guarda el sonido como WAV o MP3 para insertarlo. Si el panel de vista
previa de abajo muestra ese mismo sonido y has puesto allí fundidos, una
parte, un tono o Reverso, **Insertar**, el doble clic e **Intro** lo ponen
en la línea de tiempo con todo eso, igual que el botón **Añadir** del
propio panel.

**El panel de escucha**, abajo en la pestaña, muestra el archivo elegido
y se queda a la vista mientras la lista se desplaza:
- su **forma de onda**: haz clic en cualquier punto para saltar ahí.
  **Arrastra** sobre ella para seleccionar una parte: ▶ reproduce solo esa
  parte, y Bucle la repite. Arrastra un borde de la parte para mover solo
  ese borde, como al recortar un clip. Los dos cuadraditos de arriba son
  **tiradores de fundido**, como los tiradores de fundido de un clip en la
  línea de tiempo de Premiere: arrastra uno **hacia los lados** para la
  duración del fundido de entrada o de salida, y **arriba o abajo** para
  su curva, de -100 a 100 (0 es potencia igual, el Constant Power de
  Premiere; hacia arriba el sonido se mantiene fuerte más tiempo y cae de
  golpe al final; hacia abajo se desvanece pronto y largo). Doble clic en
  un tirador devuelve su curva a 0. La forma de onda se adelgaza donde se
  desvanece y una línea naranja muestra el volumen. Sin una parte
  seleccionada, los fundidos se aplican a todo el archivo. La línea bajo
  la forma de onda muestra la parte, la duración y la curva de cada
  fundido y —en Premiere— en qué fundido de Premiere se convierte;
  **Borrar** vuelve al archivo entero sin fundidos;
- **▶** para reproducir o pausar, con el tiempo reproducido y la
  duración;
- **Bucle**, **Reverso** y el volumen (**Vol**, se recuerda);
- **Tono − / +** en semitonos, hasta 12 en cada sentido, como un sampler:
  más agudo también suena más rápido y más corto, más grave más lento y
  más largo. **Restablecer** vuelve a 0. Cada sonido nuevo empieza en 0,
  hacia delante, sin parte seleccionada y sin fundidos. Para un sonido con tonalidad o nota, una línea debajo
  indica en qué lo convierte el cambio («Tonalidad: 8A A menor → 10A B
  menor»);
- **En tono**: transpone cada sonido que escuchas a la tonalidad del clip
  de música seleccionado (según la tonalidad guardada del original
  y la velocidad actual); **Añadir** coloca entonces el propio archivo con
  ese tono. Un sonido va
  por el camino más corto a la tonalidad del clip; un sonido mayor sobre
  una canción menor va a la relativa mayor de la canción (el mismo
  número Camelot, que combina con ella): ningún cambio de tono convierte
  mayor en menor. Los sonidos sin una tonalidad clara suenan tal cual.
  **Insertar**, un doble clic e **Intro** en una fila también le dan ese
  tono a un sonido, aunque el panel de escucha aún no lo haya cargado.
  Pulsa de nuevo para desactivarlo. Cuando el clip seleccionado no tiene
  tonalidad, En tono se desactiva solo y dice por qué;
- **Añadir** lo pone en la línea de tiempo en el cursor, como Insertar.
  Con una parte seleccionada y / o fundidos (sin cambio de tono ni
  Reverso) inserta el **archivo original, recortado a esa parte, con
  fundidos que aún puedes cambiar en la línea de tiempo**: en Premiere
  como las propias transiciones de fundido de Premiere en los bordes del
  clip (redondeadas a fotogramas enteros; Premiere tiene tres formas de
  fundido —Constant Power, Constant Gain, Exponential Fade— y se usa la
  más cercana a tu curva, como indica la línea bajo la forma de onda), en
  After Effects como fotogramas clave de volumen que siguen la curva con
  exactitud. El cambio de tono y el Reverso se aplican en el propio
  clip, nunca en una copia: en Premiere es la velocidad del clip (más
  agudo también es más rápido y más corto, como un sampler; Reverso lo
  reproduce al revés), en After Effects el Time Stretch de la capa
  (negativo para el Reverso). Los fundidos se miden en la línea de
  tiempo, así que con un cambio de tono son un poco más cortos que en la
  vista previa. Si Premiere o After Effects no acepta el recorte, el
  cambio de tono o el Reverso, el clip se vuelve a quitar y el panel lo
  dice; no se pone nada en su lugar. Downbeat nunca escribe en ningún
  sitio una copia procesada de tu sonido.

**Espacio para la lista.** La pestaña Biblioteca usa toda la altura del
panel: la lista crece con el panel (también en un segundo monitor), y
solo se desplaza la lista. Cuando el panel mide al menos 900 px de ancho,
el panel de escucha se coloca a la derecha de la lista, con una forma de
onda más alta.

**El teclado** (Espacio, Intro) funciona después de un clic en una fila
de la Biblioteca, pero no mientras escribes en los campos de búsqueda o
de BPM, ni mientras están abiertos los Ajustes, un cuadro de diálogo o una
lista desplegable. Las demás teclas (J K L, Supr, atajos con Ctrl / Cmd)
van a Premiere o After Effects como siempre.

El panel reproduce WAV (de 8 a 32 bits, float de 32/64 bits) y AIFF /
AIFF-C con el lector propio del plugin, en estéreo y a su propia
frecuencia de muestreo. MP3, M4A / AAC, FLAC y OGG pasan por el
decodificador del panel, a la frecuencia guardada en el archivo, así que
nada se remuestrea. Un archivo demasiado largo para guardarlo aquí (más o menos
más de 10 minutos de estéreo a 96 kHz ya decodificado; un MP3 decodificado
ocupa muchas veces su tamaño) dice «Demasiado largo para cargarlo aquí» y
suena tal cual, sin cambio de tono ni reverso. Un AIFF demasiado largo no se
puede escuchar aquí, pero **Insertar** lo pone igual en la línea de tiempo.

Por velocidad, el análisis lee parte de cada archivo: una pista de hasta
100 segundos entera, una más larga durante 90 segundos desde el segundo 30
(para que una intro larga no decida) y los primeros 30 segundos de un
efecto de sonido. Los
efectos de sonido no reciben tempo: el tempo detectado en un sonido
corto rara vez significa algo (whooshes, crashes, voces). Un tempo
escrito en el nombre del archivo («Drum Loop 120bpm») sí se muestra. La
mayoría de los efectos de sonido —pasos, viento, lluvia, disparos, la
mayoría de los whooshes— no tienen tono, así que una tonalidad no
significaría nada para ellos: en su lugar muestran **sin tono
definido**, y una búsqueda por tonalidad los omite. Una tonalidad
escrita en el nombre del archivo siempre cuenta. Las tonalidades de la
música se deciden como en el modo **Música** de Detectar tonalidad (los
perfiles clásicos, la progresión de acordes y S-KEY; los dos últimos
juntos superan al primero). Los clips que analizas o de los que detectas
la tonalidad en la línea de tiempo también aparecen, en la sección que
corresponde al interruptor Música / Efecto de sonido que usaste.

**Guardar copia**, **Cargar copia** y **Borrar** están en Ajustes →
Biblioteca (ver abajo).

## Copiar / pegar marcadores

En **Más**. **Copiar marcadores** guarda en memoria los marcadores del
clip seleccionado. Selecciona otro clip —en la misma secuencia o en
otra— y **Pegar marcadores aquí** los recrea en la posición correcta. Copiar
nunca elimina nada; borra los marcadores que ya no necesites en la propia aplicación.

Solo se transfieren los marcadores dentro del intervalo audible del clip seleccionado. Sus posiciones se miden desde el inicio audible y se adaptan al recorte y la velocidad del destino. Se conservan nombres, comentarios, duraciones y metadatos compatibles; se omiten los marcadores que empiezan fuera del destino; su duración puede superar el final. La transferencia funciona dentro de la misma aplicación. En Premiere, los marcadores pegados en otro clip del mismo archivo conservan su lugar en la canción, sean cuales sean los dos recortes, así que los marcadores de tiempo siguen en el tiempo.

## Ajustes

El icono del engranaje, arriba a la derecha:

- **Guía / FAQ**: este texto.
- **Repetir el recorrido**: un paseo por el panel que incluye la pista de
  metrónomo, el intervalo de análisis de tonalidad y la tonalidad fijada a
  mano, Cambiar el tono del clip, Audio terminado y las actualizaciones.
- **Idioma**: inglés, ruso o español.
- **Biblioteca**:
  - **Guardar copia…** escribe toda la biblioteca —carpetas y resultados
    del análisis— en un archivo que elijas.
  - **Cargar copia…** la recupera sin analizar de nuevo. Añade a lo que ya
    hay y nunca quita nada, así que también sirve para pasar una
    biblioteca a un plugin reinstalado (en otro equipo, los archivos en
    otras rutas se descartan en el siguiente Iniciar análisis). Las
    estrellas y las tonalidades fijadas a mano también vuelven, incluso en
    sonidos que la biblioteca ya tiene, y el panel dice en cuántos.
  - **Borrar** vacía la biblioteca (púlsalo y vuelve a pulsar para
    confirmar; un doble clic rápido no cuenta): las
    carpetas añadidas, todos los sonidos analizados, los favoritos y los
    clips analizados. Tus archivos y carpetas de audio en el disco nunca se
    tocan. Después, cierra y vuelve a abrir el panel de Downbeat.
- **Audio terminado**: dónde se guardan los WAV nuevos (la pista de
  metrónomo): Documentos/Downbeat/processed, una carpeta Downbeat/processed
  junto al proyecto guardado (guarda antes el proyecto) o una carpeta que
  elijas. El cambio solo afecta a archivos nuevos: no se mueve ni se
  sobrescribe nada. Los ajustes y las bibliotecas siguen en
  Documentos/Downbeat, los archivos temporales en la carpeta temporal del
  sistema, y Eliminar mis datos conserva estos WAV.
  Cambiar el tono y Reverso nunca generan audio procesado.
- **Actualizaciones**: **Comprobar ahora** aparece primero y consulta una
  sola vez aunque los avisos estén desactivados. **Avisarme de una versión
  nueva** activa una comprobación cada tres días, sin descargas ni instalación
  automáticas. El análisis funciona sin internet.
  **Abrir la página de la versión** abre la nueva versión en el navegador
  tras confirmar. Descarga el paquete de tu sistema e instálalo con un
  instalador ZXP; después reinicia Premiere Pro o After Effects. El panel
  no descarga paquetes ni abre el instalador.
- **Eliminar mis datos**: quita los ajustes, las dos bibliotecas (los
  clips analizados, y Música / SFX con sus carpetas y resultados) y los
  archivos temporales que hayan quedado y que Downbeat guardó (ver «¿Dónde
  guarda Downbeat sus datos…?» más abajo), y nada más: tus archivos de audio
  nunca se tocan. Antes de borrar nada, muestra la lista exacta de archivos;
  si es larga, desplázala para llegar a los botones. Después solo queda el
  idioma del panel (y el recorrido no vuelve a mostrarse); todos los demás
  ajustes vuelven a sus valores iniciales. Si algún archivo no se puede
  eliminar, el panel lo dice: ciérralo y vuelve a abrirlo, y luego inténtalo
  de nuevo.
- **Diagnóstico**: **Copiar registro** pone todo el registro en el
  portapapeles: es lo que conviene enviar al informar de un problema.
  Primero reproduce el problema en la misma sesión, luego copia el registro
  y envíalo con los pasos y una captura de pantalla. El registro contiene
  las versiones del plugin y de la aplicación y los errores; no se envía a
  ningún sitio por sí solo. Puede mostrar las rutas de tus archivos de
  audio: revísalo antes de publicarlo.
- **Acerca de**: Enviar comentarios, la Licencia y los componentes de
  terceros sobre los que está hecho Downbeat.

## En After Effects

Downbeat también funciona en After Effects 2025 (25.0) o posterior: **Window →
Extensions → Downbeat**. Algunas cosas están más limitadas ahí —lo dice
una nota bajo el encabezado hasta que pulsas **Entendido**— y el trabajo
con sonido es más cómodo en Premiere Pro. Por lo demás funciona igual,
con una capa en lugar de un clip:

- Selecciona la capa de audio en la línea de tiempo de la composición (un
  archivo de audio o un vídeo con sonido). Analizar y Detectar tonalidad
  leen el archivo de esa capa. La línea del clip nombra la composición que
  se va a cambiar y el archivo («Comp > Song.wav»); tras un clic en el panel
  Project puede ser otra composición distinta de la que está en pantalla.
  Una capa que Downbeat no puede usar (Time Remap, invertida, un vídeo sin
  sonido, una precomposición) recibe ahí su motivo.
- **Colocar marcadores** pone marcadores de capa en ella, para que se
  muevan con la capa, o, con **Dónde: Línea de tiempo**, marcadores de
  composición. Cada marcador de composición lleva también la capa para la
  que se colocó (un segundo parámetro, «DownbeatLayer», visible solo en el
  cuadro Marker), así que Colocar y Borrar en una capa nunca se llevan los
  marcadores de otra. Tras **Split Layer**, **Borrar** en cualquier trozo
  borra todos los trozos. Para cortar ahí, **J** y **K** llevan el cursor al
  marcador anterior o siguiente, y **Edit → Split Layer** (⌘⇧D en Mac,
  Ctrl+Mayús+D en Windows) divide la capa en el cursor.
- Los marcadores siempre van al inicio del fotograma en el que empieza el
  tiempo: After Effects no tiene Show Audio Time Units, y su cursor y
  Split Layer funcionan en fotogramas enteros, así que aquí no hay ajuste
  de Precisión (ni Desplazar).
- Se admite Time Stretch positivo y constante: el análisis lee el audio
  original y los marcadores se ajustan a la capa. Se rechazan el Stretch
  negativo y Time Remap, que requieren otro mapeo temporal.
- Los colores de los marcadores usan los colores de etiqueta de After
  Effects: D verde, b azul. Un marcador de After Effects tiene un solo
  texto, que muestra la etiqueta corta; la explicación más larga que
  Premiere guarda en los comentarios del marcador no se añade.
- **Copiar / pegar marcadores** funciona entre capas, en la misma
  composición o en otra.
- **Cambiar el tono del clip** pone la capa nueva justo encima de la capa de
  la que sale y apaga el sonido de esa capa; tus marcadores de capa pasan a
  ella, los de Downbeat no. Un sonido de la Biblioteca entra
  como capa nueva arriba, en el tiempo actual.

## FAQ

**¿Por qué el detector eligió el tiempo equivocado como «uno»?**
Cuál es el tiempo «uno» es la parte más difícil de detectar los
tiempos, y ningún método acierta siempre. Downbeat usa dos detectores y
una serie de comprobaciones, y la vista previa te deja oír el resultado.
Si está mal, **El «uno» es el tiempo 1 2 3 4** lo corrige en un segundo,
sin volver a analizar.

**¿Por qué un marcador está un poco distinto de lo que esperaba?**
Los tiempos detectados vienen de un audio real e imperfecto. Si la pista
tiene un tempo realmente constante y conoces su BPM exacto, escríbelo en
**BPM propio** y pulsa **Usar**: eso coloca una cuadrícula exactamente
regular. Los marcadores detectados también se igualan a lo largo de la
línea de tempo de la pista (siguiente pregunta); si toda una pista queda
unos ms antes o después, **Desplazar − / +** la alinea.

**¿Los marcadores caen exactamente en el tiempo o en un fotograma de
vídeo?**
Los detectores de tiempos suelen marcar un tiempo unos milisegundos
después de que empiece el golpe; Downbeat lo corrige: un marcador queda
al inicio del golpe o un pelo antes, no después. El segundo detector
informa los tiempos en pasos de 20 ms, así que por sí solo cada marcador
podría quedar hasta 10 ms a cualquier lado de su tiempo; Downbeat iguala
los marcadores a lo largo de la línea de tempo de la pista (los tiempos
alrededor de cada uno), lo que normalmente los deja muy cerca del tiempo
en música hecha con un tempo constante. Un cambio brusco de tempo
empieza una línea nueva, y un tiempo muy alejado de la línea se queda
donde se encontró. La línea de tiempo se dibuja y se ajusta en
fotogramas (a 25 fps un fotograma son 40 ms), así que por defecto cada
marcador va al **inicio del fotograma de vídeo en el que empieza el
tiempo**: un corte ahí cae en el tiempo o hasta un fotograma antes,
nunca después. Para cortar entre fotogramas, elige **Precisión →
Exacto** y activa **Show Audio Time Units** en el menú del panel
Timeline (☰ junto al nombre de la secuencia): la regla cuenta entonces
muestras de audio, y puedes cortar en el tiempo exacto. Un script no
puede activar ese modo por ti. Dónde «empieza» un golpe en una mezcla
completa varía un poco de una pista a otra (un bajo o un pad pueden
adelantarse a la batería unos ms), así que una pista entera aún puede
quedar unos ms antes o después: haz zoom en un marcador y usa
**Desplazar − / +** para alinear esa pista.

**¿Esta herramienta da por hecho un compás de 4/4?**
Sí: no hay detección de compás. En una pista que no está en 4/4, la
elección del tiempo fuerte puede parecer equivocada con seguridad en vez
de dudosa; ahí es más seguro Tipo: Compases + tiempos.

**¿Hay un límite de duración para Analizar?**
Analizar lee el archivo entero, y el análisis de tiempos llega a unos 30
minutos de audio. Un archivo más largo (una sesión de DJ, un concierto
grabado) se detiene con un mensaje que lo dice: guarda la parte que
necesitas como un archivo aparte y analízala. Detectar tonalidad y el
escaneo de la Biblioteca no tienen ese límite. En el otro extremo, el audio
de menos de 2 segundos, o en silencio, no se analiza.

**¿Se sube alguna vez mi audio o los datos del proyecto?**
No. El análisis y la Biblioteca se ejecutan por completo en tu equipo. La
única petición de red es la comprobación de actualizaciones (**Comprobar
ahora** o los avisos opcionales), que pide a GitHub la última versión y no
envía nada sobre tu audio ni tus proyectos.

**Un programa de seguridad (BlockBlock, Little Snitch…) pregunta por `node`. ¿Qué es?**
Es el propio análisis de Downbeat. Analizar, Detectar tonalidad y el
escaneo de la Biblioteca funcionan en una copia de Node.js que viene dentro
del plugin (firmada por la Node.js Foundation): inicia `analyze-worker.js`,
`beatthis-worker.js` o `skey-worker.js` desde la carpeta `worker` del
plugin. Todo ocurre en tu equipo y no se conecta a internet. Permítelo de
forma permanente (no «una vez» ni «temporalmente») y las preguntas dejarán
de aparecer. Si el sistema o un programa de seguridad lo bloquea, la línea
del clip lo dice: permite Downbeat ahí e inténtalo de nuevo.

**¿Dónde guarda Downbeat sus datos y cómo los quito?**
En la carpeta Documentos/Downbeat: tus ajustes y la biblioteca (qué
carpetas añadiste y qué resultado dio cada archivo, nunca el audio en sí).
Los archivos temporales de corta vida usados durante el análisis van a una
carpeta «Downbeat» dentro de la carpeta temporal del sistema, así que
OneDrive e iCloud no los ofrecen para sincronizar (Documentos/Downbeat/tmp
si la carpeta temporal del sistema no se puede usar). Cada uno se borra en
cuanto termina su análisis, y también cuando se cierra o se recarga el
panel durante un análisis; un análisis atascado termina solo al pasar su
tiempo límite. Lo que quede de hace unas horas se limpia en un inicio posterior. **Ajustes →
Eliminar mis datos** quita exactamente esos archivos y nada más; si pusiste
algo tuyo en esas carpetas, se queda. Desinstalar el plugin no toca la
carpeta Documentos, así que pulsa Eliminar mis datos primero si quieres que
no quede nada.

Cada archivo se guarda escribiendo una copia nueva y sustituyendo la
anterior, así que un fallo o un disco lleno a mitad del guardado deja entera
la versión previa. Si aun así un archivo guardado no se puede leer, Downbeat
conserva su contenido al lado como `<nombre>.unreadable-<fecha>-<hora>.json`
(nunca guarda encima de esa copia), lo indica en la pestaña Biblioteca y
empieza esa parte vacía. Unos ajustes ilegibles se indican en una línea bajo
el encabezado, con el nombre de la copia conservada, y se usan los valores
por defecto; si settings.json no se puede abrir en absoluto, esa línea dice
que los ajustes no se guardan hasta reiniciar Premiere o After Effects, y
las preguntas del primer inicio y el recorrido no empiezan. Cuando un
guardado falla, una línea bajo el encabezado lo dice hasta que ese archivo
se vuelva a guardar. Si Windows rechaza el guardado (otro programa, como
OneDrive o un antivirus, tiene el archivo abierto), los datos nuevos quedan al
lado como `<nombre>.unsaved-<fecha>-<hora>.json`; cada inicio incorpora esas
copias, y Downbeat solo borra una cuando un guardado posterior ya ha escrito sus
datos.
Premiere Pro y After Effects pueden usar Downbeat a la vez: antes de guardar
sus cambios, cada panel incorpora lo que guardó el otro, y un ajuste cambiado
en los dos en el mismo momento no se pierde, ni tampoco las estrellas, las
tonalidades fijadas a mano y los valores de **Desplazar** de ninguno de los
dos; tras Eliminar mis datos en uno, el panel del otro se vacía en lugar de volver a guardar los datos
antiguos. Los análisis de canciones en un disco desconectado se conservan hasta
que vuelve.

**¿Downbeat es gratis? ¿Puedo ver el código fuente?**
Sí a las dos. Downbeat es software libre bajo la GNU AGPL-3.0 (Ajustes →
Licencia tiene el texto completo), que te permite usarlo, estudiarlo,
compartirlo y cambiarlo. Un archivo incluido tiene otras condiciones: los
pesos del modelo de tonalidad S-KEY (models/skey.onnx), que sus autores
limitan a la investigación no comercial (Ajustes → Licencias de terceros).
El código fuente completo está en GitHub,
y los archivos del plugin instalado son código normal y legible.
