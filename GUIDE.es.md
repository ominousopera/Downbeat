# Downbeat: Guía / FAQ

## Qué hace

Downbeat escucha un clip de audio seleccionado en Premiere Pro, o una capa
de audio en After Effects, ya sea música o efectos de sonido. Encuentra el
tempo y los tiempos, coloca marcadores donde cortar y detecta la tonalidad.
Todo se ejecuta en tu equipo y nunca se sube nada.

Necesita Premiere Pro 2025 (25.0) o After Effects 2025 (25.0) o posterior
(probado en 2026), en macOS 13.5 o posterior (Apple Silicon o Intel) o en
Windows 10 u 11 (x64). Windows en ARM aún no es compatible.

## Flujo de trabajo habitual

1. Selecciona un clip de audio en la línea de tiempo de Premiere.
2. En la pestaña **Analizar**, pulsa **Analizar audio seleccionado**.
   Downbeat encuentra el BPM, los tiempos y los tiempos fuertes (el «uno»
   de cada compás). En este paso solo calcula: todavía no pone nada en la
   línea de tiempo.
3. Comprueba los tiempos fuertes de oído con la vista previa (▶ bajo la
   forma de onda; suena un clic en cada tiempo fuerte). Si el «uno» cae
   en el tiempo equivocado, corrígelo con **El «uno» es el tiempo 1 2 3 4**:
   pulsa el tiempo que de verdad es el «uno».
4. **Colocar marcadores** es el único botón que escribe marcadores de
   verdad. **Dónde** elige a dónde van:
   - **Clip**: los marcadores se quedan con el audio cuando mueves o
     recortas el clip. Pertenecen al archivo de medios, así que aparecen
     en cada uso de ese archivo dentro del proyecto.
   - **Línea de tiempo**: marcadores de secuencia en la regla de la línea
     de tiempo, sobre el clip. Se quedan en su sitio cuando mueves el
     clip.

   Si vuelves a colocar, eliges otro tiempo como «uno» después de colocar
   o cambias entre el clip y la línea de tiempo, Downbeat sustituye sus
   marcadores anteriores en vez de añadir un segundo juego. Solo sustituye
   el juego colocado para este clip. Los marcadores de Downbeat de otro
   clip se quedan, también donde los dos clips se solapan, después de
   mover, recortar o cortar un clip y después de Edición → Deshacer. Los
   marcadores que añadiste tú nunca se tocan, aunque se llamen D o b. Si
   cambias el comentario o la duración de un marcador de Downbeat (en
   After Effects, también el color), pasa a ser tuyo. After Effects admite
   un solo marcador por instante, así que un tiempo que cae justo sobre
   uno de tus marcadores se omite ahí (el registro lo cuenta). Para
   empezar de cero, **Borrar** quita los marcadores de Downbeat del clip
   (de todos los trozos si lo cortaste, esté seleccionado el trozo que
   esté) y deja los tuyos y los de otros clips.
5. Corta en los marcadores en Premiere: con el ajuste activado (S), la
   herramienta Cuchilla (C) se ajusta a los marcadores. Cada marcador está
   al inicio del fotograma de vídeo en el que empieza su tiempo, así que
   un corte cae en el tiempo o justo antes, nunca después. (Para After
   Effects, ver más abajo.)

## La pestaña Analizar

Tiene secciones numeradas, de arriba abajo:

- **01 / Clip**: **Analizar audio seleccionado**, y debajo la forma de
  onda con los tiempos fuertes, ▶ para escuchar y el clic en los tiempos
  fuertes. Después de un análisis, el botón se convierte en un pequeño
  enlace «analizar de nuevo». Si el nombre del archivo indica que es un
  videoclip («Official Music Video», «MV»…), una nota bajo el clip pide
  revisar los marcadores de la intro y del final, porque los videoclips
  suelen tener diálogos o efectos de sonido ahí. La canción en sí se
  analiza como cualquier otra pista, y los vídeos con letra y las subidas
  «Official Audio» no reciben la nota. Cuando algo no se puede hacer, la
  línea con el nombre del clip explica el motivo con el mensaje entero y
  lo deja a la vista hasta tu siguiente clic, tecla o selección. Pasa, por
  ejemplo, cuando **Colocar marcadores** no tiene ningún tiempo dentro del
  clip, o cuando el clip no tiene un archivo de audio propio (una
  secuencia anidada, una multicámara o un clip combinado). El audio de
  menos de 2 segundos, o en silencio, también se rechaza ahí, sin
  inventarle una cuadrícula. Los detalles técnicos van al registro
  (Ajustes → Diagnóstico → Copiar registro).
- **02 / Tempo**: de arriba abajo, una línea por etiqueta:
  - el **BPM** que encontró el análisis, en letra grande. Si el clip se
    reproduce a una velocidad distinta del 100 %, una línea debajo da el
    tempo tal como suena en la línea de tiempo (BPM × velocidad);
  - **BPM propio**: escribe un tempo y pulsa **Usar** para poner en su
    lugar una cuadrícula exactamente regular (**Deshacer** devuelve el
    análisis). La cuadrícula se cuenta desde el inicio del clip, donde
    caen un tiempo y un «uno». También llega hacia atrás hasta el inicio
    del archivo y, si alargas el clip, sigue al mismo tempo, así que un
    recorte posterior mantiene la misma cuadrícula. La línea del clip
    muestra entonces ese BPM;
  - **Mitad / doble**: **½×** o **2×**, para cuando el tempo salió a la
    mitad o al doble del real. Sobre una cuadrícula **Afinada** el
    resultado es una **Básica** (la línea **Cuadrícula** marca Básica), y
    el botón contrario devuelve la Afinada. El BPM mostrado y guardado
    sigue el cambio;
  - **Cuadrícula: Afinada / Básica**: aparece cuando se ejecutó el
    segundo detector o cuando podría ayudar; ver «Segundo detector de
    tiempos» más abajo;
  - **El «uno» es el tiempo 1 2 3 4** elige qué tiempo cuenta como el
    primero del compás cuando el análisis se equivocó. 1 es donde lo puso
    el análisis (y lo devuelve ahí); 2, 3 o 4 mueven el «uno» a ese
    tiempo. Si pulsas aquí o en **Desplazar** justo cuando se selecciona
    otro clip, el clic se rechaza («El clip seleccionado cambió»):
    selecciona el clip y vuelve a pulsar.
- **03 / Marcadores**: en **Tipo**, **Compases** pone un marcador en el
  «uno» de cada compás y **Compases + tiempos** añade también los demás
  tiempos del compás (el «uno» de cada compás sigue siendo tiempo
  fuerte). **Dónde** es Clip o Línea de tiempo. **Precisión** (Premiere)
  es Fotograma o Exacto (ver más abajo). Con Exacto, **Desplazar − / +**
  mueve todos los marcadores de esta pista 1 ms antes o después con cada
  clic. Sirve para una pista en la que todos los marcadores quedan un
  poco antes o después de los golpes. Los marcadores ya colocados se
  mueven al momento, y el desplazamiento se recuerda para esa pista
  (hasta ±30 ms).
- Abajo están **Colocar marcadores**, **Borrar** y **Más** (copiar y
  pegar marcadores).
- **Añadir pista de metrónomo** (bajo esos botones) crea una pista de
  clics a partir de la cuadrícula actual: un WAV mono de 44,1 kHz con
  todos los tiempos y un acento en cada «uno». Sigue tu «uno», los
  ajustes de la cuadrícula y el recorte y la velocidad del clip. Empieza
  con la música, no en el cursor, y va debajo de ella. En Premiere entra
  en una pista de audio bajo la música que no esté bloqueada ni
  silenciada y tenga sitio para todo el WAV (si no hay ninguna libre, se
  añade una pista); en After Effects, en una capa nueva justo debajo de
  la capa de la música. La música se sigue oyendo. La carpeta donde se
  guarda el WAV se elige en **Ajustes → Audio terminado**; si no se puede
  insertar, la línea junto al botón muestra dónde se guardó. La pista de
  clics puede durar hasta 30 minutos.

Downbeat guarda cada análisis junto con el tamaño y la fecha del archivo.
Si sustituyes el archivo, se analiza de nuevo; si el archivo cambia
mientras se analiza, el resultado se descarta. Si los datos de tiempos de
un análisis guardado no sirven, se conserva su tonalidad y la cuadrícula
necesita un nuevo Analizar. Una corrección de tempo (**½×**, **2×**,
**Afinada**) que sigue en marcha cuando eliges otro clip o empiezas otro
análisis se descarta, así que nunca sustituye a una cuadrícula más nueva.
Si en la misma sesión vuelves a seleccionar un clip del mismo archivo
(tras un recorte o después de otro clip), vuelve la cuadrícula que
tenías: el «uno» elegido, **BPM propio** con su **Deshacer**, y **Básica**
o **Afinada** (Básica al instante, sin un análisis nuevo). El panel lo
recuerda para los últimos 12 archivos. Después de reiniciar el programa,
y también con una canción analizada en el otro programa, al seleccionar
el clip vuelven su tempo y su cuadrícula guardados; en ese caso, cambiar
entre **Básica** y **Afinada** vuelve a analizar el clip antes.

## Segundo detector de tiempos (Beat This!)

Cada análisis ejecuta dos detectores de tiempos sobre el mismo audio: el
algoritmo habitual y después un pequeño modelo de IA local (Beat This!),
que suele acertar mejor cuál es el tiempo «uno». El resultado del modelo
solo se usa si pasa unas comprobaciones frente al primero (por ejemplo,
no debe oír la pista a la mitad o al doble de velocidad); si no, se queda
el resultado habitual. Esto añade unos segundos por pista. El BPM se mide
a partir de los tiempos que usan los marcadores, así que coincide con
ellos; cambiar la **Cuadrícula** puede moverlo unas décimas.

**Tempo → Cuadrícula** muestra qué resultado se usa: **Afinada** (se
aplicó el segundo detector) o **Básica** (solo el resultado habitual).
Escucha los marcadores y, si no caen en los tiempos, pulsa la otra
palabra. Básica vuelve al instante; Afinada ejecuta de nuevo el segundo
detector (unos segundos). Si el segundo detector no termina, se queda
Básica, la línea **Cuadrícula** lo indica y un clic en **Afinada** lo
intenta otra vez.

En una pista difícil de leer, la línea bajo **Cuadrícula** lo avisa y
sugiere **Afinada**, que en esos casos suele ser más precisa.

Con **Afinada**, el segundo detector también coloca el «uno» de cada
compás. Cuenta los compases de toda la canción a la vez, así que el «uno»
llega cada cuatro tiempos y no salta a un tercer tiempo fuerte. Las
canciones en 6/8 o 12/8 también se cuentan de cuatro en cuatro. Si sus
tiempos no pasan las comprobaciones y se queda la cuadrícula habitual (en
ese caso la línea **Cuadrícula** no aparece), cuenta los compases igual,
sobre los tiempos habituales. Si el detector no está seguro de dónde
empiezan los compases, un aviso bajo **El «uno» es el tiempo** lo indica.
Escucha el clic y, si el «uno» no cae bien, pulsa en **1 2 3 4** el
tiempo que de verdad es el «uno», o cambia la **Cuadrícula** a
**Básica**.

## Tipos de marcador

Cada marcador tiene un color y una etiqueta según su función:

| Etiqueta | Significado | Color en Premiere |
|---|---|---|
| D | Tiempo fuerte: el «uno» de un compás | Verde |
| b | Tiempo normal (Tipo: Compases + tiempos) | Azul |

Cada marcador lleva también una breve explicación, visible en el panel
Marcadores de Premiere. **Tipo** (Compases o Compases + tiempos) decide
cuáles de estos marcadores obtienes.

## Herramientas de marcadores

**Más**, abajo en la pestaña Analizar, abre las opciones para copiar y
pegar marcadores entre clips (ver más abajo).

## Vista previa con clic en los tiempos

Después del análisis aparece una pequeña vista previa de la forma de onda
con un botón de reproducción y un clic en cada tiempo fuerte, para que
compruebes la detección de oído antes de colocar o cortar nada. Al
desplazarte se mueve la vista, y con Alt (Opción en Mac) + desplazamiento
se hace zoom; también puedes usar los botones +/−/Ajustar. Pista y Clic
tienen controles de volumen separados. Elegir un «uno», usar
**Desplazar** o recortar el clip no detiene la reproducción ni cambia el
zoom.

## Detectar tonalidad

Es independiente del análisis. Primero elige **Música** o **Efecto de
sonido**: cada modo necesita ajustes de análisis distintos y guarda su
propio resultado para un archivo. El resultado se muestra en la rueda
Camelot y en notación tradicional, junto con las tonalidades que combinan
bien con él.

**Analizar: Archivo completo / Clip seleccionado** elige qué se mide: todo
el archivo o solo la parte que usa el clip seleccionado (entre su entrada
y su salida). Cada recorte distinto tiene su propio resultado (se guardan
las últimas 12 partes de un archivo, y una tonalidad fijada a mano para
una parte se guarda siempre). El análisis de tiempos y la vista previa no
cambian. Una parte muy corta, o una en la que la música cambia de
tonalidad, puede dar una tonalidad poco fiable.

Bajo el resultado, una línea indica cuánto puedes fiarte de él. En modo
**Música** opinan tres análisis independientes: los perfiles clásicos de
tonalidad, la progresión de acordes y un pequeño modelo de IA (S-KEY). Si
los dos últimos coinciden contra el primero, gana su respuesta. Cuando
coinciden los tres, la tonalidad es fiable; cuando coinciden dos o
ninguno, escucha antes de fiarte. En música de dos minutos o más, la
progresión de acordes solo se lee cuando las otras dos opiniones difieren
(si coinciden, no cambiaría la respuesta), y entonces la línea habla de
dos opiniones. En modo **Efecto de sonido** el análisis está ajustado
para sonidos en lugar de canciones: usa una ventana de análisis más
larga, que oye mejor las notas graves, y no usa el modelo de IA (está
entrenado con música y aquí funciona peor). La segunda opinión es la
progresión de acordes. Los sonidos de menos de 10 segundos reciben una
nota que avisa de que, con tan poco audio, la tonalidad es menos fiable.

Si ya conoces la tonalidad, puedes fijarla a mano con **Ajustar tonalidad
del original**: escribe su código Camelot, como 8A u 11B (cualquier otra
cosa muestra una breve pista). Se guarda para ese archivo y esa parte.
**Usar tonalidad detectada**, junto a **Detectar tonalidad**, recupera la
tonalidad detectada. Sustituir el archivo de audio borra su análisis y la
tonalidad fijada a mano.

**Cambio de tono** (bajo el resultado): elige la tonalidad en la que está
un sonido y la que quieres, y te da los números para tu propio plugin de
cambio de tono (semitonos, cents y porcentaje de velocidad). También avisa
cuando un destino no se puede alcanzar, por ejemplo de menor a mayor.

**Cambiar el tono del clip** lo hace por ti, igual que cambia el tono la
vista previa de la biblioteca: como en un sampler, más agudo también suena
más rápido y más corto. Coloca el propio archivo del clip seleccionado (la
parte que usa la línea de tiempo) en el lugar del clip, en una pista libre
y a la velocidad que da ese cambio. Nunca usa una pista bloqueada o
silenciada, y un clip estéreo nunca va a una pista mono o 5.1. No se crea
ninguna copia: sigue siendo tu archivo, donde está. El original se queda
donde estaba, desactivado (Desactivar en Premiere, sin sonido en After
Effects); para deshacerlo, vuelve a activarlo. Un clip que ya está
desactivado se rechaza, porque puede que aún suene una copia anterior con
el tono cambiado; selecciona el clip que suena. En Premiere solo entra el
sonido, nunca la imagen del archivo. Un archivo con varios canales mono
necesita una pista libre para cada uno, cada parte recibe la nueva
velocidad y los demás canales del original se desactivan con él (nunca se
eliminan).

**Cambiar el tono del clip** está junto a los números de semitonos /
cents / velocidad (debajo de ellos en un panel estrecho). Cada cambio se
suma a la velocidad actual del clip: +2 y luego otros +2 dan 125,99 %, y
volver a la tonalidad original devuelve el 100 %. Se muestra la velocidad
final del clip, y la línea de BPM va del tempo actual al nuevo. Si la
selección o la velocidad cambian antes de pulsar, revisa los números
nuevos y vuelve a pulsar (mover el clip, o añadir una capa encima, no
cuenta como cambio). Después queda seleccionado el clip (capa) nuevo, así
que el siguiente **Detectar tonalidad** oye su velocidad; si la aplicación
no puede seleccionarlo, el panel te pide que lo hagas tú. Con **Analizar:
Clip seleccionado**, el clip nuevo conserva la tonalidad de esa parte.
Empieza sin marcadores de Downbeat, así que vuelve a colocarlos para su
velocidad. Tus marcadores pasan a él, en el mismo punto del sonido, y el
clip original conserva los suyos. Los marcadores de línea de tiempo de
Downbeat colocados para el original pasan a ser del clip nuevo: **Colocar
marcadores** o **Borrar** en él sustituye todo ese juego, incluidos los
marcadores que quedan después del final del clip nuevo si es más corto.
En Premiere el clip nuevo tiene su propio elemento de proyecto, así que
borrar sus marcadores no toca el original. Un cambio de tono rechazado no
deja ningún elemento sin usar en el proyecto.

**Tonalidad del original** es lo que Detectar tonalidad midió en el propio
archivo (o en la parte elegida). No cambia con la velocidad: un archivo en
la menor sigue siendo 8A. **Tonalidad en la línea de tiempo (calculada)**
es la tonalidad en la que suena el clip a su velocidad actual (el mismo
archivo a +2 semitonos suena en si menor, 10A). Es el resultado
principal: la rueda, las tonalidades compatibles, **Como el clip** y
**En tono** la siguen, y se actualiza cuando cambia la velocidad del clip.
Con velocidades distintas del 100 %, una línea adicional explica el
cambio (por ejemplo «5A, +3 semitonos»). Una velocidad entre semitonos
enteros no tiene una tonalidad Camelot exacta, así que no se puede
emparejar ni cambiar de tono automáticamente. Los efectos de audio, el
estiramiento que conserva el tono y Maintain Audio Pitch de Premiere no
entran en este cálculo.

## Pestaña Biblioteca: Música y SFX

Puedes añadir carpetas de audio, o una unidad entera, una tarjeta de
memoria o una carpeta de red; lo único que no se puede añadir entero es el
disco del sistema. Las carpetas de Música y SFX no deben solaparse. Si aun
así una carpeta está en las dos, sus archivos aparecen en una sola sección
y el panel lo indica (no se elimina nada). El escaneo se salta las
carpetas de papelera y de instantáneas del sistema y de las unidades de
red (`$RECYCLE.BIN`, `System Volume Information`, `#recycle`, `@Recycle`,
`@eaDir`, `#snapshot` y similares), así que un sonido eliminado no vuelve
a aparecer en la Biblioteca. Un escaneo cuenta hasta 50.000 archivos; si
hay más, añade carpetas más pequeñas. El siguiente Iniciar análisis vuelve
a intentar los archivos que dieron error, y una carpeta que no se pudo
leer conserva los registros que ya tenía. Si sustituyes un archivo en la
misma ruta, su vista previa se vuelve a leer antes de insertarlo.

La biblioteca tiene dos secciones, **Música** y **SFX**, y cada una se
forma con carpetas de tu equipo.

- Pulsa **+ Carpeta** una vez por carpeta (se incluyen las subcarpetas).
  Los archivos de audio de la carpeta (wav, aiff, mp3, m4a, aac, flac,
  ogg) aparecen al momento como «pendiente de análisis». Todavía no se
  ejecuta nada pesado, así que puedes añadir varias carpetas primero.
- **Iniciar análisis (N)** analiza los N archivos pendientes. Cada archivo
  se analiza una vez; más adelante, Iniciar análisis también encuentra
  archivos nuevos o cambiados en las carpetas y analiza solo esos. Los
  efectos de sonido cortos van rápido, y la música, más despacio (se
  analizan varios archivos a la vez).
- Se usan las tonalidades y los tempos de los nombres de archivo. Muchos
  packs de samples los indican («Key C#min», «F# minor», «120bpm»,
  «8A - 128 - …», tonalidad Camelot y tempo). El nombre tiene prioridad
  sobre la detección, y un archivo cuyo nombre da todo lo necesario (la
  tonalidad y, para la música, también el tempo) no se analiza. Si el
  nombre solo da la nota base justo al lado de su marca de BPM («Loopable
  D_90 bpm»), o si la carpeta se llama como una nota, se conserva esa
  nota y el modo mayor/menor sale del análisis. Una carpeta llamada solo
  con una letra de «A» a «G» cuenta únicamente si las carpetas de al lado
  también son notas y alguna lleva sostenido, bemol o modo (A, A#, B,
  C…), como en un pack ordenado por notas; en una biblioteca ordenada por
  la primera letra no cuenta. La nota de una carpeta nunca da tonalidad a
  un sonido sin tono definido. En la lista, esos valores aparecen
  marcados «del nombre del archivo». Las formas cortas como «Am» solo
  cuentan en un sitio inequívoco («_Am_», «(Am)», o justo al lado de la
  marca de BPM: «Loop 120bpm Am»), porque en texto normal suelen ser
  palabras: un título como «Am I Ready Yet 120 BPM» sí se analiza.
- En la música, la tonalidad sale de tres métodos. La fila dice
  «tonalidad confirmada» si al menos dos dieron la misma, y «tonalidad
  incierta» (en rojo) si los tres difieren; esas conviene comprobarlas de
  oído. Una tonalidad tomada del nombre del archivo y los efectos de
  sonido no llevan esa indicación.
- Mientras se ejecuta un análisis, que usa toda la potencia del equipo,
  una ventana cubre el panel y muestra el progreso, el tiempo restante y
  **Cancelar**. Los archivos analizados hasta ese momento se conservan, e
  Iniciar análisis continúa con el resto.
- Las carpetas se muestran como un árbol, con el número de archivos de
  cada una; la flecha pequeña abre las subcarpetas. Con más de tres
  carpetas, el árbol se pliega en una línea «▸ Carpetas (N)»; púlsala
  para abrirlo o cerrarlo. La × junto a una carpeta la quita de la
  biblioteca, pero los archivos en sí nunca se tocan.
- El cuadrado a la izquierda de una carpeta la incluye en la búsqueda. Si
  hay algún cuadrado activado, la lista y la búsqueda muestran solo los
  archivos de esas carpetas (y de sus subcarpetas). Puedes activar varios
  a la vez, por ejemplo dos packs de entre diez. Un clic en el nombre de
  una carpeta muestra solo esa carpeta; pulsa de nuevo, o **Todas las
  carpetas**, para verlo todo. La línea plegada indica entonces lo
  elegido («Carpetas (3) · Airy Pack»), y **Restablecer** también quita la
  elección. Se recuerda por separado para Música y SFX.
- La biblioteca guarda dónde está cada sonido en tu equipo y nunca lo
  copia. Un archivo que se movió, se renombró o se eliminó, o que está en
  un disco no conectado, aparece como **archivo no encontrado** (atenuado,
  sin Escuchar ni Insertar), y una carpeta añadida que no está aparece en
  el árbol con «no encontrada» junto al nombre. Cuando el disco vuelve a
  estar conectado, todo regresa solo, con su análisis y sus favoritos; el
  panel lo detecta cuando vuelves a hacer clic en él o en una fila
  atenuada. Iniciar análisis nunca quita los sonidos de una carpeta que
  falta: sus archivos esperan, y el panel dice cuántos son. Solo quita los
  archivos que ya no están en una carpeta disponible, e incluso entonces
  conserva un sonido con estrella o con una tonalidad fijada a mano
  (mostrado como **archivo no encontrado**): el de estrella, hasta que le
  quites la estrella; el de tonalidad fijada a mano, hasta que quites su
  carpeta con ×. Un archivo movido a otro sitio de la misma sección, con
  el mismo nombre, tamaño y fecha, conserva su análisis y su estrella.
  Para quitar una carpeta del todo, usa su ×.

Para encontrar algo:

- **Buscar**: busca en los nombres de archivos y de carpetas, al inicio
  de las palabras («hit» encuentra «Big Hit», no «white»; «trac» encuentra
  «Tractor»). Cada palabra que escribas debe coincidir. Las palabras con
  guion o apóstrofo («sci-fi», «sub-drop», «don't») y los nombres con
  tildes se encuentran tal como los escribes. Una búsqueda por nombre
  también muestra los sonidos que aún esperan análisis o que no se
  pudieron leer (un filtro de tonalidad o de BPM necesita un análisis).
  También conoce sinónimos de efectos de sonido y categorías de sonido:
  «swoosh» encuentra además archivos whoosh, swish y fly-by; «hit»,
  también impact, punch y thud (y las categorías de impactos de UCS);
  «riser», también uplifter y build-up. Pon un signo menos delante de una
  palabra para excluirla: «whoosh -fire». Los archivos cuyos nombres
  coinciden mejor van primero. Escribir el nombre de una carpeta encuentra
  los archivos que contiene (y los de sus subcarpetas). A la derecha del
  campo **Buscar**, el panel muestra las otras palabras que también busca
  («+ uplifter, swell»). La **✕** que va detrás busca solo las palabras
  que escribiste, y **+ sinónimos** las vuelve a activar (se recuerda).
- Muchas bibliotecas comerciales nombran los archivos según el Universal
  Category System (UCS), por ejemplo «DSGNWhsh_Airy Pass_Example
  Audio_Airy Pack.wav»: categoría DESIGNED / WHOOSH, del pack Airy Pack
  de Example Audio. La búsqueda encuentra esos archivos también por su
  categoría, aunque esa parte del nombre no la diga, y por creador o pack
  («example audio», «airy pack»). Con el panel en ruso o en español, una
  búsqueda en ese idioma encuentra los archivos con nombre en inglés
  (gracias a las traducciones propias de UCS).
- **Tonalidad**: la tonalidad Camelot, exacta o con **+ compatibles** (la
  misma tonalidad, sus vecinas en la rueda y su relativa mayor/menor).
- **BPM** (Música): un tempo y cuánto puede desviarse (±%). «también ½×
  y 2×» encuentra además archivos a la mitad o al doble de ese tempo, que
  suelen montarse bien juntos.
- **Como el clip** (un botón) rellena la tonalidad y el BPM del clip
  seleccionado, calculados a partir del análisis guardado del original y
  de la velocidad actual, para encontrar sonidos compatibles. Cuando el
  clip seleccionado no tiene tonalidad ni tempo (otro clip, o ninguno),
  Como el clip se desactiva y dice por qué. **Restablecer** quita todos
  los filtros.
- **Orden**: mejor coincidencia, nombre, duración o tempo (Música).
- **★** en una fila lo marca como favorito, y **Favoritos** muestra solo
  tus favoritos. Los favoritos se guardan con la biblioteca.
- **Con tono** (SFX) oculta los sonidos que muestran «sin tono definido».

Las mejores coincidencias van primero. La lista muestra los primeros 300
archivos y **Mostrar 300 más**, al final, añade los siguientes; cuando
eliges una tonalidad, muestra todas las coincidencias (hasta 3.000). Un
clic en una fila elige el archivo. En cualquier fila mostrada, **Espacio**
lo escucha e **Intro** lo inserta, igual que **Insertar**. Pulsa ▶ para
escuchar. **Insertar** (o un doble clic en la fila) pone el archivo en la
línea de tiempo, en el cursor, una vez por doble clic; un doble clic en ▶
o ★ nunca inserta. En Premiere va a la primera pista de audio que esté
libre durante todo el sonido, no esté bloqueada ni silenciada y admita sus
canales (un sonido estéreo se salta las pistas mono y 5.1). No se
sobrescribe nada, y si no hay una pista así, el panel lo dice. En After
Effects entra como una capa nueva en el tiempo actual. El archivo se
importa una vez a una bandeja «Downbeat» (una carpeta, en After Effects)
y después se reutiliza. En Premiere, los puntos de entrada y salida que
pusiste a ese sonido en la bandeja siguen como estaban después de una
inserción, y una inserción del sonido entero coloca el sonido entero, no
solo el tramo entre tu entrada y tu salida. Los archivos FLAC y OGG se
pueden escuchar pero no insertar, porque Premiere Pro y After Effects no
los importan, y el panel lo avisa; guarda el sonido como WAV o MP3 para
insertarlo. Si el panel de vista previa de abajo muestra ese mismo sonido
y has puesto allí fundidos, una parte, un tono o Reverso, **Insertar**, el
doble clic e **Intro** lo ponen en la línea de tiempo con todo eso, igual
que el botón **Añadir** del propio panel.

El panel de escucha, abajo en la pestaña, muestra el archivo elegido y se
queda a la vista mientras la lista se desplaza:
- su forma de onda: haz clic en cualquier punto para saltar ahí. Arrastra
  sobre ella para seleccionar una parte: ▶ reproduce solo esa parte y
  Bucle la repite. Arrastra un borde de la parte para mover solo ese
  borde, como al recortar un clip. Los dos cuadraditos de arriba son
  tiradores de fundido, como los de un clip en la línea de tiempo de
  Premiere. Arrastra uno hacia los lados para cambiar la duración del
  fundido de entrada o de salida, y arriba o abajo para cambiar su curva,
  de -100 a 100. El 0 es una curva de potencia constante (el Constant
  Power de Premiere); hacia arriba, el sonido se mantiene fuerte más
  tiempo y cae de golpe al final; hacia abajo, empieza a bajar pronto y
  se apaga despacio. Un doble clic en un tirador devuelve su curva a 0. La
  forma de onda se adelgaza donde el sonido baja, y una línea naranja
  muestra el volumen. Sin una parte seleccionada, los fundidos se aplican
  a todo el archivo. La línea bajo la forma de onda muestra la parte, la
  duración y la curva de cada fundido y, en Premiere, en qué fundido de
  Premiere se convierte. **Borrar** vuelve al archivo entero sin fundidos;
- **▶** para reproducir o pausar, con el tiempo reproducido y la
  duración;
- **Bucle**, **Reverso** y el volumen (**Vol**, se recuerda);
- **Tono − / +** en semitonos, hasta 12 en cada sentido, como un sampler:
  más agudo también suena más rápido y más corto, y más grave, más lento y
  más largo. **Restablecer** vuelve a 0. Cada sonido nuevo empieza en 0,
  sin Reverso, sin parte seleccionada y sin fundidos. Para un sonido con
  tonalidad o nota, una línea debajo indica en qué lo convierte el cambio
  («Tonalidad: 8A A menor → 10A B menor»);
- **En tono**: transpone cada sonido que escuchas a la tonalidad del clip
  de música seleccionado (según la tonalidad guardada del original y la
  velocidad actual), y **Añadir** coloca entonces el propio archivo con
  ese tono. Un sonido va por el camino más corto a la tonalidad del clip.
  Un sonido mayor sobre una canción menor va a la relativa mayor de la
  canción (el mismo número Camelot, que combina con ella), porque ningún
  cambio de tono convierte mayor en menor. Los sonidos sin una tonalidad
  clara suenan tal cual. **Insertar**, un doble clic e **Intro** en una
  fila también le dan ese tono a un sonido, aunque el panel de escucha aún
  no lo haya cargado. Pulsa de nuevo para desactivarlo. Cuando el clip
  seleccionado no tiene tonalidad, En tono se desactiva solo y dice por
  qué;
- **Añadir** lo pone en la línea de tiempo en el cursor, como Insertar.
  Con una parte seleccionada, fundidos o ambas cosas (sin cambio de tono
  ni Reverso), inserta el archivo original recortado a esa parte, con
  fundidos que aún puedes cambiar en la línea de tiempo. En Premiere son
  las propias transiciones de fundido de Premiere en los bordes del clip,
  redondeadas a fotogramas enteros. Premiere tiene tres formas de fundido
  (Constant Power, Constant Gain, Exponential Fade) y se usa la más
  cercana a tu curva, como indica la línea bajo la forma de onda. En After
  Effects son fotogramas clave de volumen que siguen la curva con
  exactitud. El cambio de tono y el Reverso se aplican en el propio clip,
  nunca en una copia: en Premiere es la velocidad del clip (más agudo
  también es más rápido y más corto, como un sampler; Reverso lo
  reproduce al revés), y en After Effects, el Time Stretch de la capa
  (negativo para el Reverso). Los fundidos se miden en la línea de tiempo,
  así que con un cambio de tono son un poco más cortos que en la vista
  previa. Si Premiere o After Effects no acepta el recorte, el cambio de
  tono o el Reverso, el clip se vuelve a quitar y el panel lo dice; no se
  pone nada en su lugar. Downbeat nunca escribe en ningún sitio una copia
  procesada de tu sonido.

La pestaña Biblioteca usa toda la altura del panel: la lista crece con el
panel (también en un segundo monitor) y solo se desplaza la lista. Cuando
el panel mide al menos 900 px de ancho, el panel de escucha se coloca a la
derecha de la lista, con una forma de onda más alta.

Las teclas Espacio e Intro funcionan después de un clic en una fila de la
Biblioteca, pero no mientras escribes en los campos de búsqueda o de BPM,
ni mientras están abiertos los Ajustes, un cuadro de diálogo o una lista
desplegable. Las demás teclas (J K L, Supr, atajos con Ctrl / Cmd) van a
Premiere o After Effects como siempre.

El panel reproduce WAV (de 8 a 32 bits, float de 32/64 bits) y AIFF /
AIFF-C con el lector propio del plugin, en estéreo y a su propia
frecuencia de muestreo. MP3, M4A / AAC, FLAC y OGG pasan por el
decodificador del panel, a la frecuencia guardada en el archivo, así que
nada se remuestrea. Si un archivo es demasiado largo para cargarlo aquí (a
partir de unos 10 minutos de estéreo a 96 kHz ya decodificado; un MP3
decodificado ocupa muchas veces su tamaño), el panel dice «Demasiado largo
para cargarlo aquí» y lo reproduce tal cual, sin cambio de tono ni
reverso. Un AIFF demasiado largo no se puede escuchar aquí, pero
**Insertar** lo pone igual en la línea de tiempo.

Para ir más rápido, el análisis lee una parte de cada archivo: una pista
de hasta 100 segundos, entera; una más larga, 90 segundos a partir del
segundo 30 (para que una intro larga no decida el resultado); y de un
efecto de sonido, los primeros 30 segundos. Los efectos de sonido no
reciben tempo, porque el tempo detectado en un sonido corto rara vez
significa algo (whooshes, crashes, voces). Un tempo escrito en el nombre
del archivo («Drum Loop 120bpm») sí se muestra. La mayoría de los efectos
de sonido (pasos, viento, lluvia, disparos, la mayoría de los whooshes)
no tienen tono, así que una tonalidad no significaría nada para ellos: en
su lugar muestran **sin tono definido**, y una búsqueda por tonalidad los
omite. Una tonalidad escrita en el nombre del archivo siempre cuenta. Las
tonalidades de la música se deciden como en el modo **Música** de
Detectar tonalidad (los perfiles clásicos, la progresión de acordes y
S-KEY; los dos últimos juntos superan al primero). Los clips que analizas
en la línea de tiempo, o cuya tonalidad detectas allí, también aparecen en
la sección que corresponde al interruptor Música / Efecto de sonido que
usaste.

**Guardar copia**, **Cargar copia** y **Borrar** están en Ajustes →
Biblioteca (ver más abajo).

## Copiar / pegar marcadores

Están en **Más**. **Copiar marcadores** guarda en memoria los marcadores
del clip seleccionado. Selecciona otro clip, en la misma secuencia o en
otra, y **Pegar marcadores aquí** los recrea en la posición correcta.
Copiar nunca elimina nada; los marcadores que ya no necesites, bórralos en
la propia aplicación.

Solo se transfieren los marcadores que están dentro del intervalo audible
del clip seleccionado. Sus posiciones se miden desde el inicio audible y
se adaptan al recorte y a la velocidad del destino. Se conservan nombres,
comentarios, duraciones y metadatos compatibles. Los marcadores que
empiezan fuera del destino se omiten, y la duración de un marcador puede
pasar del final. La transferencia funciona dentro de la misma aplicación.
En Premiere, los marcadores pegados en otro clip del mismo archivo
conservan su lugar en la canción, sean cuales sean los dos recortes, así
que los marcadores de tiempo siguen cayendo en el tiempo.

## Ajustes

Se abren con el icono del engranaje, arriba a la derecha:

- **Guía / FAQ**: este texto.
- **Repetir el recorrido**: un paseo por el panel que incluye la pista de
  metrónomo, el intervalo de análisis de tonalidad y la tonalidad fijada a
  mano, Cambiar el tono del clip, Audio terminado y las actualizaciones.
- **Idioma**: inglés, ruso o español.
- **Biblioteca**:
  - **Guardar copia…** escribe toda la biblioteca (carpetas y resultados
    del análisis) en un archivo que elijas.
  - **Cargar copia…** la recupera sin analizar de nuevo. Añade a lo que
    ya hay y nunca quita nada, así que también sirve para pasar una
    biblioteca a un plugin reinstalado (en otro equipo, los archivos que
    estén en otras rutas se descartan en el siguiente Iniciar análisis).
    Las estrellas y las tonalidades fijadas a mano también vuelven,
    incluso en sonidos que la biblioteca ya tiene, y el panel dice en
    cuántos.
  - **Borrar** vacía la biblioteca: las carpetas añadidas, todos los
    sonidos analizados, los favoritos y los clips analizados. Para
    confirmar, púlsalo y vuelve a pulsar (un doble clic rápido no
    cuenta). Tus archivos y carpetas de audio en el disco nunca se tocan.
    Después, cierra y vuelve a abrir el panel de Downbeat.
- **Audio terminado**: dónde se guardan los WAV nuevos (la pista de
  metrónomo). Puede ser Documentos/Downbeat/processed, una carpeta
  Downbeat/processed junto al proyecto guardado (guarda antes el
  proyecto) o una carpeta que elijas. El cambio solo afecta a archivos
  nuevos: no se mueve ni se sobrescribe nada. Los ajustes y las
  bibliotecas siguen en Documentos/Downbeat, los archivos temporales en la
  carpeta temporal del sistema, y Eliminar mis datos conserva estos WAV.
  Cambiar el tono y Reverso nunca generan audio procesado.
- **Actualizaciones**: **Comprobar ahora** aparece primero y consulta una
  sola vez, aunque los avisos estén desactivados. **Avisarme de una
  versión nueva** activa una comprobación cada tres días, sin descargas ni
  instalación automáticas. El análisis funciona sin internet. **Abrir la
  página de la versión** abre la nueva versión en el navegador después de
  pedir confirmación. Descarga el paquete de tu sistema e instálalo con un
  instalador ZXP; después reinicia Premiere Pro o After Effects. El panel
  no descarga paquetes ni abre el instalador.
- **Eliminar mis datos**: quita los ajustes, las dos bibliotecas (los
  clips analizados, y Música / SFX con sus carpetas y resultados) y los
  archivos temporales que Downbeat guardó y que hayan quedado (ver
  «¿Dónde guarda Downbeat sus datos…?» más abajo), y nada más. Tus
  archivos de audio nunca se tocan. Antes de borrar nada, muestra la lista
  exacta de archivos; si es larga, desplázala para llegar a los botones.
  Después solo queda el idioma del panel (y el recorrido no vuelve a
  mostrarse); todos los demás ajustes vuelven a sus valores iniciales. Si
  algún archivo no se puede eliminar, el panel lo dice: cierra el panel,
  vuelve a abrirlo e inténtalo de nuevo.
- **Diagnóstico**: **Copiar registro** pone todo el registro en el
  portapapeles, y es lo que conviene enviar al informar de un problema.
  Primero reproduce el problema en la misma sesión, luego copia el
  registro y envíalo con los pasos y una captura de pantalla. El registro
  contiene las versiones del plugin y de la aplicación y los errores, y no
  se envía a ningún sitio por sí solo. Puede mostrar las rutas de tus
  archivos de audio, así que revísalo antes de publicarlo.
- **Acerca de**: Enviar comentarios, la Licencia y los componentes de
  terceros sobre los que está hecho Downbeat.

## En After Effects

Downbeat también funciona en After Effects 2025 (25.0) o posterior:
**Window → Extensions → Downbeat**. Ahí algunas cosas están más limitadas
(una nota bajo el encabezado lo indica hasta que pulsas **Entendido**), y
el trabajo con sonido es más cómodo en Premiere Pro. Por lo demás funciona
igual, con una capa en lugar de un clip:

- Selecciona la capa de audio en la línea de tiempo de la composición (un
  archivo de audio o un vídeo con sonido). Analizar y Detectar tonalidad
  leen el archivo de esa capa. La línea del clip nombra la composición que
  se va a cambiar y el archivo («Comp > Song.wav»); después de un clic en
  el panel Project puede ser una composición distinta de la que está en
  pantalla. Si Downbeat no puede usar una capa (Time Remap, invertida, un
  vídeo sin sonido, una precomposición), esa línea explica el motivo.
- **Colocar marcadores** pone marcadores de capa en ella, para que se
  muevan con la capa, o marcadores de composición con **Dónde: Línea de
  tiempo**. Cada marcador de composición guarda también la capa para la
  que se colocó (en un segundo parámetro, «DownbeatLayer», visible solo en
  el cuadro Marker), así que Colocar y Borrar en una capa nunca se llevan
  los marcadores de otra. Después de **Split Layer**, **Borrar** en
  cualquier trozo quita los marcadores de Downbeat de todos los trozos.
  Para cortar ahí, **J** y **K** llevan el cursor al marcador anterior o
  siguiente, y **Edit → Split Layer** (⌘⇧D en Mac, Ctrl+Mayús+D en
  Windows) divide la capa en el cursor.
- Los marcadores siempre van al inicio del fotograma en el que empieza el
  tiempo. After Effects no tiene Show Audio Time Units, y su cursor y
  Split Layer funcionan en fotogramas enteros, así que aquí no hay ajuste
  de Precisión (ni Desplazar).
- Se admite un Time Stretch positivo y constante: el análisis lee el audio
  original y los marcadores se ajustan a la capa. Se rechazan el Stretch
  negativo y Time Remap, que requieren otro mapeo temporal.
- Los marcadores usan los colores de etiqueta de After Effects: D verde,
  b azul. Un marcador de After Effects tiene un solo texto, que muestra la
  etiqueta corta; no se añade la explicación más larga que Premiere guarda
  en los comentarios del marcador.
- **Copiar / pegar marcadores** funciona entre capas, en la misma
  composición o en otra.
- **Cambiar el tono del clip** pone la capa nueva justo encima de la capa
  de la que sale y apaga el sonido de esa capa; tus marcadores de capa
  pasan a la nueva, los de Downbeat no. Un sonido de la Biblioteca entra
  como capa nueva arriba, en el tiempo actual.

## FAQ

**¿Por qué el detector eligió el tiempo equivocado como «uno»?**
Encontrar el «uno» es lo más difícil de la detección de tiempos, y ningún
método acierta siempre. Downbeat usa dos detectores y una serie de
comprobaciones, y la vista previa te deja oír el resultado. Si está mal,
**El «uno» es el tiempo 1 2 3 4** lo corrige en un segundo, sin volver a
analizar.

**¿Por qué un marcador no cae justo donde esperaba?**
Los tiempos detectados salen de un audio real e imperfecto. Si la pista
tiene un tempo realmente constante y conoces su BPM exacto, escríbelo en
**BPM propio** y pulsa **Usar** para poner una cuadrícula exactamente
regular. Los marcadores detectados también se igualan a lo largo de la
línea de tempo de la pista (ver la siguiente pregunta); si toda una pista
queda unos ms antes o después, **Desplazar − / +** la alinea.

**¿Los marcadores caen exactamente en el tiempo o en un fotograma de
vídeo?**
Los detectores de tiempos suelen marcar un tiempo unos milisegundos
después de que empiece el golpe. Downbeat lo corrige, y un marcador queda
al inicio del golpe o un pelo antes, no después. El segundo detector da
los tiempos en pasos de 20 ms, así que por sí solo cada marcador podría
quedar hasta 10 ms a cualquier lado de su tiempo. Downbeat iguala los
marcadores a lo largo de la línea de tempo de la pista (los tiempos
alrededor de cada uno), y eso normalmente los deja muy cerca del tiempo
en música hecha con un tempo constante. Un cambio brusco de tempo empieza
una línea nueva, y un tiempo muy alejado de la línea se queda donde se
encontró. La línea de tiempo se dibuja y se ajusta en fotogramas (a 25
fps un fotograma son 40 ms), así que por defecto cada marcador va al
inicio del fotograma de vídeo en el que empieza el tiempo: un corte ahí
cae en el tiempo o hasta un fotograma antes, nunca después. Para cortar
entre fotogramas, elige **Precisión → Exacto** y activa **Show Audio Time
Units** en el menú del panel Timeline (☰ junto al nombre de la
secuencia). La regla cuenta entonces muestras de audio y puedes cortar en
el tiempo exacto. Un script no puede activar ese modo por ti. Dónde
«empieza» un golpe en una mezcla completa varía un poco de una pista a
otra (un bajo o un pad pueden adelantarse a la batería unos ms), así que
una pista entera aún puede quedar unos ms antes o después: haz zoom en un
marcador y usa **Desplazar − / +** para alinear esa pista.

**¿Esta herramienta da por hecho un compás de 4/4?**
Sí: no hay detección de compás. En una pista que no está en 4/4, la
elección del tiempo fuerte puede ser errónea y aun así parecer segura; en
esas pistas conviene usar Tipo: Compases + tiempos.

**¿Hay un límite de duración para Analizar?**
Analizar lee el archivo entero, y el análisis de tiempos llega a unos 30
minutos de audio. Con un archivo más largo (una sesión de DJ, un concierto
grabado), el análisis se detiene con un mensaje que lo explica: guarda la
parte que necesitas como un archivo aparte y analízala. Detectar
tonalidad y el escaneo de la Biblioteca no tienen ese límite. En el otro
extremo, el audio de menos de 2 segundos, o en silencio, no se analiza.

**¿Se sube alguna vez mi audio o los datos del proyecto?**
No. El análisis y la Biblioteca se ejecutan por completo en tu equipo. La
única petición de red es la comprobación de actualizaciones (**Comprobar
ahora** o los avisos opcionales), que pide a GitHub la última versión y no
envía nada sobre tu audio ni tus proyectos.

**Un programa de seguridad (BlockBlock, Little Snitch…) pregunta por `node`. ¿Qué es?**
Es el propio análisis de Downbeat. Analizar, Detectar tonalidad y el
escaneo de la Biblioteca funcionan en una copia de Node.js que viene
dentro del plugin (firmada por la Node.js Foundation), que inicia
`analyze-worker.js`, `beatthis-worker.js` o `skey-worker.js` desde la
carpeta `worker` del plugin. Todo ocurre en tu equipo y no se conecta a
internet. Permítelo de forma permanente (no «una vez» ni
«temporalmente») y las preguntas dejarán de aparecer. Si el sistema o un
programa de seguridad lo bloquea, la línea del clip lo indica: permite
Downbeat ahí e inténtalo de nuevo.

**¿Dónde guarda Downbeat sus datos y cómo los quito?**
En la carpeta Documentos/Downbeat están tus ajustes y la biblioteca (qué
carpetas añadiste y qué resultado dio cada archivo, nunca el audio en
sí). Los archivos temporales que se usan durante el análisis, que duran
poco, van a una carpeta «Downbeat» dentro de la carpeta temporal del
sistema, así que OneDrive e iCloud no los ofrecen para sincronizar (si la
carpeta temporal del sistema no se puede usar, van a
Documentos/Downbeat/tmp). Cada uno se borra en cuanto termina su
análisis, y también cuando se cierra o se recarga el panel durante un
análisis; un análisis atascado termina solo al agotar su tiempo límite.
Lo que quede de hace unas horas se limpia en un inicio posterior.
**Ajustes → Eliminar mis datos** quita exactamente esos archivos y nada
más; si pusiste algo tuyo en esas carpetas, se queda. Desinstalar el
plugin no toca la carpeta Documentos, así que, si quieres que no quede
nada, pulsa Eliminar mis datos antes de desinstalar.

Cada archivo se guarda escribiendo una copia nueva que sustituye a la
anterior, así que un fallo o un disco lleno a mitad del guardado deja
entera la versión previa. Si aun así un archivo guardado no se puede
leer, Downbeat conserva su contenido al lado como
`<nombre>.unreadable-<fecha>-<hora>.json` (nunca guarda encima de esa
copia), lo indica en la pestaña Biblioteca y empieza esa parte vacía. Si
los ajustes son ilegibles, una línea bajo el encabezado lo indica con el
nombre de la copia conservada, y se usan los valores por defecto. Si
settings.json no se puede abrir en absoluto, esa línea dice que los
ajustes no se guardan hasta reiniciar Premiere o After Effects, y las
preguntas del primer inicio y el recorrido no empiezan. Cuando un
guardado falla, una línea bajo el encabezado lo dice hasta que ese
archivo se vuelva a guardar. Si Windows rechaza el guardado (porque otro
programa, como OneDrive o un antivirus, tiene el archivo abierto), los
datos nuevos quedan al lado como `<nombre>.unsaved-<fecha>-<hora>.json`.
Cada inicio incorpora esas copias, y Downbeat solo borra una cuando un
guardado posterior ya ha escrito sus datos.

Premiere Pro y After Effects pueden usar Downbeat a la vez. Antes de
guardar sus cambios, cada panel incorpora lo que guardó el otro, así que
no se pierde un ajuste cambiado en los dos al mismo tiempo, ni las
estrellas, las tonalidades fijadas a mano o los valores de **Desplazar**
de ninguno de los dos. Después de Eliminar mis datos en uno, el panel del
otro se vacía en lugar de volver a guardar los datos antiguos. Los
análisis de canciones que están en un disco desconectado se conservan
hasta que el disco vuelve.

**¿Downbeat es gratis? ¿Puedo ver el código fuente?**
Sí a las dos cosas. Downbeat es software libre bajo la GNU AGPL-3.0 (el
texto completo está en Ajustes → Licencia), que te permite usarlo,
estudiarlo, compartirlo y cambiarlo. Un archivo incluido tiene otras
condiciones: los pesos del modelo de tonalidad S-KEY (models/skey.onnx),
que sus autores limitan a la investigación no comercial (Ajustes →
Licencias de terceros). El código fuente completo está en GitHub, y los
archivos del plugin instalado son código normal y legible.
