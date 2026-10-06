# Downbeat — Guía / FAQ

## Qué hace

Downbeat escucha un clip de audio seleccionado en Premiere Pro, o una capa
de audio en After Effects (música o efectos de sonido). Encuentra el tempo
y los tiempos, coloca marcadores donde cortar y detecta la tonalidad.
Todo se ejecuta en tu equipo: nunca se sube nada.

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
   anteriores de Downbeat en vez de añadir un segundo juego. Los
   marcadores que añadiste tú nunca se tocan. Para empezar de cero,
   **Borrar** quita los marcadores de Downbeat del clip —de cada trozo
   después de un corte— y deja los tuyos.
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
  letra y las subidas «Official Audio» no reciben la nota.
- **02 / Tempo**: de arriba abajo, una línea por etiqueta:
  - el **BPM** que encontró el análisis, en letra grande;
  - **BPM propio**: escribe un tempo y pulsa **Usar** para colocar en su
    lugar una cuadrícula exactamente regular (**Deshacer** devuelve el
    análisis);
  - **Mitad / doble**: **½×** o **2×** cuando el tempo salió a la mitad
    o al doble del real;
  - **Cuadrícula: Afinada / Básica**: aparece cuando se ejecutó el
    segundo detector o podría ayudar; ver «Segundo detector de tiempos»
    más abajo;
  - **El «uno» es el tiempo 1 2 3 4** elige qué tiempo cuenta como el
    primero del compás cuando el análisis eligió mal: 1 es donde lo puso
    el análisis (y lo devuelve ahí); 2, 3 o 4 mueven el «uno» a ese
    tiempo.
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

## Segundo detector de tiempos (Beat This!)

Cada análisis ejecuta dos detectores de tiempos sobre el mismo audio: el
algoritmo habitual y después un pequeño modelo de IA local (Beat This!),
que suele encontrar mejor cuál es el tiempo «uno». El resultado del
modelo solo se usa si pasa unas comprobaciones frente al primero (por
ejemplo, no debe oír la pista a la mitad o al doble de velocidad); si no,
se queda el resultado habitual. Añade unos segundos por pista. El tempo
(BPM) siempre viene del algoritmo habitual.

**Tempo → Cuadrícula** muestra qué resultado se usa: **Afinada** (se
aplicó el segundo detector) o **Básica** (solo el resultado habitual).
Escucha los marcadores: si no caen en los tiempos, pulsa la otra palabra.
Básica vuelve al instante; Afinada ejecuta de nuevo el segundo detector
(unos segundos).

En una pista difícil de leer, el panel sugiere **Probar análisis
alternativo**; **Volver al análisis original** lo deshace.

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

## Detectar tonalidad

Funciona independientemente del análisis. Primero elige **Música** o
**Efecto de sonido**: necesitan ajustes de análisis distintos. El
resultado se muestra en la rueda Camelot y en notación tradicional, con
las tonalidades que combinan bien con él.

Bajo el resultado, una línea indica cuánto fiarse. En modo **Música**
opinan tres análisis independientes: los perfiles clásicos de
tonalidad, la progresión de acordes y un pequeño modelo de IA (S-KEY);
si los dos últimos coinciden contra el primero, gana su respuesta.
Cuando coinciden los tres, la tonalidad es fiable; cuando coinciden dos
o ninguno, escucha antes de fiarte. En modo **Efecto de sonido** el
análisis está ajustado para sonidos y no para canciones: una ventana de
análisis más larga que oye mejor las notas graves, y sin modelo de IA
(está entrenado con música y aquí funciona peor). La segunda opinión es
la progresión de acordes. Los sonidos de menos de 10 segundos reciben una
nota que lo indica: con tan poco audio la tonalidad es menos fiable. Si
ya conoces la tonalidad, puedes fijarla a mano (**Ajustar manualmente**).

**Cambio de tono** (bajo el resultado): elige la tonalidad en la que está
un sonido y la tonalidad que quieres, y te da los números para tu propio
cambiador de tono —semitonos, cents y porcentaje de velocidad— y avisa
cuando un destino no se puede alcanzar, por ejemplo de menor a mayor.
**Cambiar el tono del clip** lo hace por ti,
igual que cambia el tono la vista previa de la biblioteca (como un
sampler: más agudo también suena más rápido y más corto): coloca el
propio archivo del clip seleccionado, la parte que usa la línea de
tiempo, en una pista libre en el lugar del clip, a la velocidad que da
ese cambio; no se crea ninguna copia, sigue siendo tu archivo donde
está. El original se queda donde estaba, desactivado (Desactivar en
Premiere, sin sonido en After Effects): vuelve a activarlo para
deshacerlo.

## Pestaña Biblioteca: Música y SFX

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
  da la nota base («Ping G», o una carpeta llamada «G») conserva esa nota
  y toma mayor/menor del análisis. Esos valores aparecen marcados «del
  nombre del archivo» en la lista. Las formas cortas como «Am» solo
  cuentan en un sitio inequívoco («_Am_», «(Am)», o junto a un BPM),
  porque en texto normal suelen ser palabras.
- **Cuánta seguridad tiene una tonalidad de música.** La tonalidad sale de tres
  métodos. La fila dice «tonalidad acordada» si al menos dos la dieron, y
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
  carpeta añadida que no está muestra «— no encontrada» en el árbol. No se
  olvida nada: cuando el disco vuelve a estar conectado, todo regresa
  solo, con su análisis y sus favoritos. Iniciar análisis nunca quita los
  sonidos de una carpeta que falta; solo quita los archivos que ya no
  están en una carpeta disponible. Para quitar una carpeta del todo, usa
  su ×.

Para encontrar algo:

- **Buscar**: busca en los nombres de archivos y de carpetas, al inicio
  de las palabras («hit» encuentra «Big Hit», no «white»; «trac» encuentra
  «Tractor»). Cada palabra que escribas debe coincidir. También conoce
  sinónimos de efectos de sonido: **swoosh** también
  encuentra archivos whoosh, swish y fly-by, **hit** también impact, punch
  y thud, **riser** también uplifter y build-up. Pon un signo menos delante
  de una palabra para excluirla: **whoosh -fire**. Los archivos cuyos
  nombres coinciden mejor van primero. Escribir el nombre de una carpeta
  encuentra los archivos que contiene (y los de sus subcarpetas). A la
  derecha del campo **Buscar**, el panel muestra las otras palabras que
  también busca («+ uplifter, swell»); la **✕** tras ellos busca solo las
  palabras que escribiste, y **+ sinónimos** los vuelve a activar (se
  recuerda).
- Muchas bibliotecas comerciales nombran los archivos según el Universal
  Category System (UCS), por ejemplo «DSGNWhsh_Airy Pass_Example
  Audio_Airy Pack.wav»: categoría DESIGNED / WHOOSH, del pack Airy Pack
  de Example Audio. La búsqueda encuentra esos archivos también por su
  categoría, aunque la parte del nombre no la diga, y por creador o pack
  («example audio», «steps pack»). Con el panel en ruso o en español, una
  búsqueda en ese idioma encuentra los archivos con nombre en inglés
  (gracias a las traducciones propias de UCS).
- **Tonalidad**: la tonalidad Camelot, exacta o **+ compatibles** (la
  misma tonalidad, sus vecinas en la rueda y su relativa mayor/menor).
- **BPM** (Música): un tempo y cuánto puede desviarse (±%). «también ½×
  y 2×» encuentra también archivos a la mitad o al doble de ese tempo, que
  suelen montarse bien juntos.
- **Como el clip** (un interruptor, como Favoritos) rellena la tonalidad
  y el BPM del último clip que analizaste en la línea de tiempo, así
  obtienes sonidos que encajan con él. **Restablecer** quita todos los
  filtros.
- **Orden**: mejor coincidencia, nombre, duración o tempo (Música).
- **★** en una fila lo marca como favorito; **Favoritos** muestra solo tus
  favoritos. Los favoritos se guardan con la biblioteca.
- **Con tono** (SFX) oculta los sonidos que muestran «sin tono definido».

Las mejores coincidencias van primero. La lista muestra los primeros 300
archivos, y **Mostrar 300 más** abajo añade los siguientes; cuando eliges
una tonalidad, muestra todas las coincidencias (hasta 3.000). En la
pestaña Biblioteca también funciona el teclado: **↑ ↓** eligen un
archivo, **Espacio** lo escucha (mientras suena uno, ↑ ↓ reproducen el
siguiente), **Intro** lo inserta. Pulsa ▶ para escuchar. **Insertar** (o
un doble clic en la fila) pone el archivo en la línea de tiempo en el
cursor: en Premiere, en la primera pista de audio que esté libre durante
todo el sonido —no se sobrescribe nada; si no hay una pista así, lo
dice—, y en After Effects como una capa nueva en el tiempo actual. El
archivo se importa una vez a una bandeja «Downbeat» (carpeta, en After
Effects) y después se reutiliza.

**El panel de escucha**, abajo en la pestaña, muestra el archivo elegido
y se queda a la vista mientras la lista se desplaza:
- su **forma de onda**: haz clic en cualquier punto para saltar ahí.
  **Arrastra** sobre ella para seleccionar una parte: ▶ reproduce solo esa
  parte, y Bucle la repite. Los dos cuadraditos de arriba son
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
  más largo. **Restablecer** vuelve a 0. Un archivo nuevo empieza en 0,
  hacia delante. Para un sonido con tonalidad o nota, una línea debajo
  indica en qué lo convierte el cambio («Tonalidad: 8A A menor → 10A B
  menor»);
- **En tono**: transpone cada sonido que escuchas a la tonalidad del clip
  de música (el último que analizaste o del que detectaste la
  tonalidad), así que recorres la lista con ↑ ↓ y ya oyes cada sonido en
  tono; **Añadir** coloca entonces el propio archivo con ese tono. Un sonido va
  por el camino más corto a la tonalidad del clip; un sonido mayor sobre
  una canción menor va a la relativa mayor de la canción (el mismo
  número Camelot, que combina con ella): ningún cambio de tono convierte
  mayor en menor. Los sonidos sin una tonalidad clara suenan tal cual.
  Pulsa de nuevo para desactivarlo;
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

**El teclado** (↑ ↓ para elegir, Espacio, Intro) funciona después de
cualquier clic en la pestaña Biblioteca, salvo en los campos de búsqueda
o de BPM: si no, Premiere se queda esas teclas para su línea de tiempo.

El panel reproduce WAV (de 8 a 32 bits, float de 32/64 bits) y AIFF /
AIFF-C con el lector propio del plugin, en estéreo y a su propia
frecuencia de muestreo. MP3, M4A / AAC, FLAC y OGG pasan por el
decodificador del panel, a la frecuencia guardada en el archivo, así que
nada se remuestrea. Un archivo demasiado largo para guardarlo aquí (más o menos
más de 10 minutos de estéreo a 96 kHz) suena tal cual, sin cambio de tono
ni reverso.

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
otra— y **Pegar marcadores aquí** los recrea en la posición correcta.
«Eliminar del origen tras copiar» los mueve en vez de copiarlos.

## Ajustes

El icono del engranaje, arriba a la derecha:

- **Guía / FAQ**: este texto.
- **Repetir el recorrido**.
- **Idioma**: inglés, ruso o español.
- **Biblioteca**:
  - **Guardar copia…** escribe toda la biblioteca —carpetas y resultados
    del análisis— en un archivo que elijas.
  - **Cargar copia…** la recupera sin analizar de nuevo. Añade a lo que ya
    hay y nunca quita nada, así que también sirve para pasar una
    biblioteca a un plugin reinstalado (en otro equipo, los archivos en
    otras rutas se descartan en el siguiente Iniciar análisis).
  - **Borrar** olvida todos los resultados del análisis (pulsa dos veces
    para confirmar). Tus carpetas se quedan, e Iniciar análisis en la
    pestaña Biblioteca las vuelve a analizar.
- **Actualizaciones**: **Avisarme de una versión nueva** se pregunta una sola vez, al
  primer inicio (un «no» deja Downbeat totalmente sin conexión); aquí puedes
  cambiarlo. Si está activado, Downbeat pregunta a GitHub una vez cada tres días por el
  número de la última versión (no se envía nada sobre ti). Si hay una versión
  más nueva, el engranaje muestra un punto y esta sección un botón que abre la
  página de la versión; la descarga y la instalación las haces tú.
  **Comprobar ahora** pregunta al momento.
- **Eliminar mis datos**: quita los ajustes, las dos bibliotecas (los
  clips analizados, y Música / SFX con sus carpetas y resultados) y los
  archivos temporales que hayan quedado y que Downbeat guardó en
  Documentos/Downbeat, y nada más: tus archivos de audio nunca se tocan. Antes de
  borrar nada, muestra la lista exacta de archivos.
- **Diagnóstico**: **Copiar registro** pone todo el registro en el
  portapapeles: es lo que conviene enviar al informar de un problema.
- **Acerca de**: Enviar comentarios, la Licencia y los componentes de
  terceros sobre los que está hecho Downbeat.

## En After Effects

Downbeat también funciona en After Effects 2021 o posterior: **Window →
Extensions → Downbeat**. Algunas cosas están más limitadas ahí —lo dice
una nota bajo el encabezado hasta que pulsas **Entendido**— y el trabajo
con sonido es más cómodo en Premiere Pro. Por lo demás funciona igual,
con una capa en lugar de un clip:

- Selecciona la capa de audio en la línea de tiempo de la composición (un
  archivo de audio o un vídeo con sonido). Analizar y Detectar tonalidad
  leen el archivo de esa capa.
- **Colocar marcadores** pone marcadores de capa en ella, para que se
  muevan con la capa, o, con **Dónde: Línea de tiempo**, marcadores de
  composición. Para cortar ahí, **J** y **K** llevan el cursor al
  marcador anterior o siguiente, y **Edit → Split Layer** (⌘⇧D en Mac,
  Ctrl+Mayús+D en Windows) divide la capa en el cursor.
- Los marcadores siempre van al inicio del fotograma en el que empieza el
  tiempo: After Effects no tiene Show Audio Time Units, y su cursor y
  Split Layer funcionan en fotogramas enteros, así que aquí no hay ajuste
  de Precisión (ni Desplazar).
- La capa debe reproducirse a velocidad normal: Stretch 100% y sin Time
  Remap. Si no, Downbeat lo dice en vez de colocar marcadores en el sitio
  equivocado.
- Los colores de los marcadores usan los colores de etiqueta de After
  Effects: D verde, b azul. Un marcador de After Effects tiene un solo
  texto, que muestra la etiqueta corta; la explicación más larga que
  Premiere guarda en los comentarios del marcador no se añade.
- **Copiar / pegar marcadores** funciona entre capas, en la misma
  composición o en otra.

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

**¿Se sube alguna vez mi audio o los datos del proyecto?**
No. Todas las funciones se ejecutan por completo en tu equipo.

**¿Dónde guarda Downbeat sus datos y cómo los quito?**
En la carpeta Documentos/Downbeat: tus ajustes, la biblioteca (qué
carpetas añadiste y qué resultado dio cada archivo, nunca el audio en sí)
y archivos temporales de corta vida usados durante el análisis (cada uno
se borra en cuanto termina su análisis). **Ajustes → Eliminar mis datos**
quita exactamente esos archivos y nada más; si pusiste algo tuyo en esa
carpeta, se queda. Desinstalar el plugin no toca la carpeta Documentos, así que pulsa
Eliminar mis datos primero si quieres que no quede nada.

**¿Downbeat es gratis? ¿Puedo ver el código fuente?**
Sí a las dos. Downbeat es software libre bajo la GNU AGPL-3.0 (Ajustes →
Licencia tiene el texto completo), que te permite usarlo, estudiarlo,
compartirlo y cambiarlo. El código fuente completo está en GitHub,
y los archivos del plugin instalado son código normal y legible.
