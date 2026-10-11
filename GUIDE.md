# Downbeat — Guide / FAQ

## What this does

Downbeat listens to a selected audio clip in Premiere Pro, or an audio
layer in After Effects (music or sound effects). It finds the tempo and
the beats, places markers where to cut, and detects the musical key.
Everything runs locally on your machine — nothing is ever uploaded.

## Typical workflow

1. Select one audio clip on the timeline in Premiere.
2. **Analyze** tab → **Analyze selected audio**. This finds the BPM, the
   beats and the downbeats (the "1" of each bar). It does not place
   anything on the timeline yet, it only computes.
3. Check the downbeats by ear: play the preview (▶ under the waveform; it
   clicks on every downbeat). If the "1" lands on the wrong beat, move it
   with **The "1" is beat 1 2 3 4**: click the beat that really is the "1".
4. **Place markers** — the one button that actually writes markers.
   **Place on** chooses where they go:
   - **Clip** — they stay with the audio when you move or trim the
     clip. (They belong to the media file, so every use of the same file
     in the project shows them.)
   - **Timeline** — sequence markers on the timeline ruler, above the
     clip. They stay put when you move the clip.

   Placing again — or choosing another beat as the "1" after placing,
   or switching between the clip and the timeline — replaces Downbeat's
   earlier markers instead of adding a second set. Markers you added
   yourself are never touched. After Effects holds one marker per moment,
   so a beat that falls exactly on one of your markers is left out there
   (the log counts it). To start over, **Clear** removes
   Downbeat's markers from the clip — from every piece of it after a cut —
   and leaves yours.
5. Cut at the markers in Premiere: with snapping on (S), the Razor tool (C)
   snaps to markers. Each marker sits on the start of the video frame its
   beat begins in, so a cut lands on the beat or just before it, never
   after. (After Effects: see below.)

## The Analyze tab

Numbered sections, top to bottom:

- **01 / Clip** — **Analyze selected audio**, then the waveform with the
  downbeats, ▶ to listen, and the click on downbeats. After an analysis
  the button becomes a small "analyze again" link. When the
  file name says it is a music video ("Official Music Video", "MV"…), a
  note under the clip asks you to check the markers in the intro and the
  ending: clips often have talking or sound effects there. The song itself
  analyzes like any track, and lyric videos and "Official Audio" uploads
  get no note.
- **02 / Tempo** — top to bottom, one label per line:
  - the **BPM** the analysis found, in large type; when the clip plays at a
    speed other than 100%, a line under it gives the tempo as it plays
    (BPM × speed);
  - **Custom BPM** — type a tempo and click **Use** to place an exactly
    even grid at it instead (**Undo** brings the analysis back);
  - **Half / double** — **½×** or **2×** when the tempo came out at half
    or double the real one;
  - **Beat grid: Refined / Basic** — shown when the second detector ran
    or could help; see "Second beat detector" below;
  - **The "1" is beat 1 2 3 4** picks which beat counts as the first of
    the bar when the analysis picked the wrong one: 1 is where the
    analysis put it (and puts it back), 2, 3 or 4 move the "1" to that
    beat.
- **03 / Markers** — **Type**: **Bars** puts one marker on the "1" of every
  bar; **Bars + beats** also puts a marker on the other beats of each bar, and
  the "1" of each bar stays a downbeat. **Place on**: Clip or Timeline.
  **Timing** (Premiere): Frame or Exact (below). With Exact, **Shift − / +**
  moves every marker of this track 1 ms earlier or later per click, for a
  track whose markers all sit a little before or after the hits; markers
  already placed move right away, and the shift is remembered for that track
  (up to ±30 ms).
- **Place markers**, **Clear** and **Tools** (copy / paste markers) at the
  bottom.

## Second beat detector (Beat This!)

Every Analyze runs two beat detectors on the same audio: the usual
algorithm, then a small local AI model (Beat This!) that is usually better
at finding which beat is "one". The model's result is used only if it
passes checks against the first one (for example, it must not hear the
track at half or double speed); otherwise the usual result stays. It adds a
few seconds per track. The tempo (BPM) always comes from the usual
algorithm.

**Tempo → Beat grid** shows which result is in use: **Refined** (the
second detector was applied) or **Basic** (the usual result only). Listen
to the markers: if they miss the beats, click the other word. Basic comes
back at once; Refined runs the second detector again (a few seconds).

On a track that is hard to read, the line under **Beat grid** says so and
suggests **Refined**, which is often more accurate there.

## Marker types

Each marker is colored and labeled by its role:

| Label | Meaning | Color in Premiere |
|---|---|---|
| D | Downbeat — the "1" of a bar | Green |
| b | Regular beat (Type: Bars + beats) | Blue |

Each marker also carries a short explanation (visible in Premiere's
Markers panel). Which types you get is set by **Type** (Bars, or Bars + beats).

## Marker tools

**Tools** at the bottom of the Analyze tab opens **Copy and paste**
markers between clips (below).

## The beat-click preview player

After Analyze, a small waveform preview appears with a play button and a
click on every downbeat, so you can check the detection by ear before
placing or cutting anything. Scroll to pan, Alt (Option on Mac) + scroll to
zoom, or use the +/−/Fit buttons. Track and Click have separate volume
sliders.

## Detect Key

Runs independently of Analyze. First pick **Music** or **Sound effect**:
the two need different analysis settings. The result is shown on the
Camelot wheel and in traditional notation, with the keys that mix well
with it.

Under the result, a line tells you how far to trust it. In **Music** mode
three independent analyses weigh in: the classic key profiles, the chord
progression, and a small AI model (S-KEY); if the last two agree against
the first, their answer wins. When all three agree the key is dependable;
when only two do, or none do, listen before relying on it. In **Sound
effect** mode the analysis is tuned for sounds rather than songs: a longer
analysis window that hears low notes better, and no AI model (it is
trained on music and does worse there). The chord progression is the
second opinion. Sounds shorter than 10 seconds get a note saying so, since
a key from so little audio is less reliable. If you already know the key,
you can set the source key by hand (Source override).

**Pitch shift** (under the result): pick the key a sound is in and the key
you want, and it gives the numbers for your own pitch shifter — semitones,
cents and speed percent — and says so when a target cannot be reached, for
example minor to major. **Pitch the clip** does it for you, the way
the Library preview pitches (like a sampler: higher also plays faster and
shorter): it puts the selected clip's own file, the part the timeline
uses, on a free track at the clip's own place, at the speed that gives
the shift — no copy is made, it is still your file where it lies. The
original stays where it was, switched off (Disable in Premiere, its sound
off in After Effects) — switch it back on to undo.

Timeline key (calculated) is the main result and drives the wheel and
matching. Source key stays separate. At speeds other than 100%, the
supplemental line explains the shift (for example "5A, +3 semitones"). A
speed between whole semitones has no exact Camelot key.

## Library tab: Music and SFX

Add audio folders, or a whole drive, memory card or network share; only the system disk cannot be added whole. Music and SFX folders must not overlap. Start scan retries failed files. Unreadable folders keep their saved records; cancellation stops pending work, and write failures release the scan controls. Replacing a file at the same path reloads its preview before insertion.

Two sections, **Music** and **SFX**, each built from folders on your
computer.

- **+ Folder** once per folder (subfolders are included). The folder's
  audio files (wav, aiff, mp3, m4a, aac, flac, ogg) show up at once as "waiting
  for analysis"; nothing heavy runs yet, so you can add several folders
  first.
- **Start scan (N)** analyzes the N waiting files. Each file is analyzed
  once; later, Start scan also finds new or changed files in the folders
  and analyzes only those. Short sound effects go through quickly,
  music more slowly (several are analyzed at once).
- **Keys and tempos in file names are used.** Many sample packs name them
  ("Key C#min", "F# minor", "120bpm", "8A - 128 - …", a Camelot key and a
  tempo). What a name says wins over detection, and a file whose name gives
  everything needed (the key, plus the tempo for music) is not analyzed at
  all. A name that gives only the root note ("Ping G", or a folder named "G")
  keeps that note and takes major/minor from the analysis. Such values are
  marked "from the file name" in the list. Short forms like "Am" count only in
  an unambiguous spot ("_Am_", "(Am)", or next to a BPM), because in plain
  text they are usually words.
- **How sure a music key is.** The key comes from three methods. The row says
  "key agreed" when at least two of them gave it, and "key uncertain" (in red)
  when all three differed; check those by ear. Keys read from a file name and
  sound effects show no such word.
- While a scan runs, a window covers the panel — it uses the computer's
  full power — showing the progress, the time left and **Cancel**. Files
  analyzed so far are kept, and Start scan continues with the rest.
- The folders show as a tree, with the number of files in each; the
  small arrow opens a folder's subfolders. With more than three folders
  the tree folds into one "▸ Folders (N)" line; click it to open or
  close it. The × next to a folder removes it from the library; the
  files themselves are never touched.
- **Choosing where to look.** The square on the left of a
  folder puts it in the search: when any square is on, the list and the
  search show only the files in those folders (and their subfolders).
  Several can be on at once — for example two packs out of ten. A click
  on a folder's name shows only that folder; click it again, or **All
  folders**, to see everything. The closed line then says what is
  chosen ("Folders (3) · Airy Pack"), and **Reset** clears it too. The
  choice is remembered, separately for Music and SFX.
- **Files that are not there any more.** The library keeps a sound's
  place on your computer; it never copies it. A file that was moved,
  renamed or deleted, or that sits on a drive that is not connected,
  shows as **file not found** (dimmed, Play and Insert off), and an added
  folder that is not there shows "— not found" in the tree. Nothing is
  forgotten: when the drive is connected again, everything comes back by
  itself, with its analysis and favorites. Start scan never removes the
  sounds of a folder that is missing; it only removes files that are gone
  from a folder that is there. To drop a folder for good, use its ×.

To find something:

- **Search** — looks in file names and folder names, at the start of
  words ("hit" finds "Big Hit", not "white"; "trac" finds "Tractor").
  Every word you type must match. It also knows sound-effect synonyms
  and sound categories: **swoosh** also finds whoosh, swish and fly-by
  files, **hit** also finds impact, punch and thud (and the UCS impact
  categories), **riser** also finds uplifter and build-up. Put a minus
  before a word to leave it out: **whoosh -fire**. Files whose names
  match best come first. Typing a folder's name finds the files in it
  (and in its subfolders). On the right of the **Find** field, the panel
  shows the other words it is also looking for ("+ uplifter, swell"); the
  **✕** after them searches only the words you typed, and **+ synonyms**
  turns them back on (remembered).
- Many commercial libraries name files by the Universal Category System
  (UCS), for example "DSGNWhsh_Airy Pass_Example Audio_Airy Pack.wav":
  category DESIGNED / WHOOSH, from the pack Airy Pack by Example Audio.
  The search finds such files by their category too, even when the name
  part does not say it, and by creator or pack ("example audio", "steps pack").
  With the panel in Russian or Spanish, a search in that language finds
  the English-named files (from UCS's own translations).
- **Key** — the Camelot key, exact or **+ compatible** (the same key, its
  neighbors on the wheel and its relative major/minor).
- **BPM** (Music) — a tempo and how far off it may be (±%). "Also ½× and
  2×" also finds files at half or double that tempo, which usually cut
  together fine.
- **Match clip** (a checkbox, like Favorites) fills in the key and BPM of
  the currently selected clip, calculated from saved source analysis and
  playback speed, so you get sounds that fit it. **Reset** clears every filter.
- **Sort** — best match, name, length, or tempo (Music).
- **★** on a row marks a favorite; **Favorites** shows just your favorites.
  Favorites are saved with the library.
- **Pitched** (SFX) hides sounds that show "no clear
  pitch".

Best matches come first. The list shows the first 300 files, and **Show
300 more** at the bottom adds the next ones; once you pick a key it shows
every match (up to 3,000). Click a row to choose a file; **Space** then
listens and **Enter** inserts it. Click ▶ to listen. **Insert** (or a double-click
on the row) puts the file on the timeline at the playhead: in Premiere on
the first audio track that is empty for the whole sound — nothing is
overwritten; if there is no such track, it says so — and in After Effects
as a new layer at the current time. The file is imported into a
"Downbeat" bin (folder, in After Effects) once and reused after that.
When the preview pane below shows that same sound and you have set fades, a
part, a pitch or Reverse there, **Insert**, the double-click and **Enter**
put it on the timeline with those, exactly like the pane's own **Add**.

**The preview pane** at the bottom of the tab shows the file you chose
and stays in view while the list scrolls:
- its **waveform** — click anywhere on it to jump there. **Drag** across
  it to select a part: ▶ then plays just that part, and Loop repeats it.
  Drag an edge of the part to move just that edge, like trimming a clip.
  The two small squares at the top are **fade handles**, like the fade
  handles on a clip in Premiere's timeline: drag one **sideways** for the
  length of the fade in or fade out, and **up or down** for its curve,
  from -100 to 100 (0 is equal power, Premiere's Constant Power; up keeps
  the sound loud longer and drops it sharply at the end; down fades early
  and long). Double-click a handle to set its curve back to 0. The
  waveform thins out where it fades and an orange line shows the volume.
  With no part selected the fades apply to the whole file. The line under
  the waveform shows the part, each fade's length and curve, and — in
  Premiere — which Premiere fade it becomes; **Clear** goes back to the
  whole file without fades;
- **▶** to play or pause, with the time played and the length;
- **Loop**, **Reverse** and the volume (**Vol**, remembered);
- **Pitch − / +** in semitones, up to 12 either way, like a sampler: higher
  also plays faster and shorter, lower slower and longer. **Reset** goes
  back to 0. A new file starts at 0, forwards. For a sound with a key or
  note, a line under it says what the pitch turns it into ("Key: 8A A
  minor → 10A B minor");
- **In key** — pitches every sound you listen to into the key of the music
  selected clip (calculated from its saved source key and playback speed), so every sound
  you listen to is already in key; **Add** then places the file itself at
  that pitch. A sound goes the shortest way to the clip's key; a major sound
  on a minor song goes to the song's relative major (the same Camelot number,
  which mixes with it) — no pitch shift can turn major into minor. Sounds with
  no clear key play as they are. Click it again to switch it off;
- **Add** puts it on the timeline at the playhead, like Insert. With a
  selected part and / or fades (no pitch, no Reverse) it inserts the
  **original file, trimmed to the part, with fades you can still change on the
  timeline**: in Premiere as Premiere's own fade transitions on the clip's
  edges (rounded to whole frames; Premiere has three fade shapes — Constant
  Power, Constant Gain, Exponential Fade — and the closest one to your curve
  is used, as the line under the waveform says), in After Effects as volume
  keyframes that follow the curve exactly. A pitch and Reverse are set on the
  clip itself, never in a copy: in Premiere the clip's speed (higher is also
  faster and shorter, like a sampler; Reverse plays it backwards), in After
  Effects the layer's Time Stretch (a negative one for Reverse). The fades are
  measured on the timeline, so at a pitch they are a little shorter than in
  the preview. If Premiere or After Effects does not take the trim, the pitch
  or Reverse, the clip is taken away again and the panel says so — nothing
  else is put in its place. Downbeat never writes a processed copy of your
  sound anywhere.

**Space for the list.** The Library tab uses the panel's whole height: the
list grows with the panel (on a second monitor too), and only the list
scrolls. When the panel is at least 900 px wide, the preview pane sits to
the right of the list, with a taller waveform.

**The keyboard** (Space, Enter) works after a click on a row of the
Library — not while you type in the search or BPM fields.

The pane plays WAV (8 to 32-bit, 32/64-bit float) and AIFF / AIFF-C with
the plugin's own reader, in stereo at their own sample rate. MP3, M4A /
AAC, FLAC and OGG go through the panel's decoder, at the sample rate
stored in the file, so nothing is resampled. A file too long to hold here
(roughly over 10 minutes of 96 kHz stereo) plays as is, without pitch or
reverse.

For speed the scan reads part of each file: a track of up to 100 seconds
whole, a longer one for 90 seconds starting 30 seconds in (so a long intro
does not decide), and the first 30 seconds of a sound effect. Sound effects get no tempo: a tempo
detected for a one-shot sound is rarely meaningful (whooshes, crashes,
voices). A tempo written in the file name ("Drum Loop 120bpm") still
shows. Most sound effects — footsteps, wind, rain, gunshots, most
whooshes — have no pitch, so a key would mean nothing for them: they
show **no clear pitch** instead, and a key search skips them. A key
written in the file name always counts. Music keys are decided the way
Detect Key's **Music** mode decides them (the classic profiles, the
chord progression and S-KEY; the last two together outvote the first).
Clips you Analyze or Detect Key on the timeline are listed too, in the
section matching the Music / Sound effect switch you used.

**Save a copy**, **Load a copy** and **Clear** are in Settings → Library (see
below).

## Copy/paste markers

In **Marker tools**. **Copy markers** reads the selected clip's markers into
memory. Select a different clip — in the same sequence or another one — and
**Paste markers here** re-creates them at the right position. Copying never
removes anything; delete unwanted markers in the host itself.

Only markers inside the selected clip’s audible range are transferred. Positions are relative to its audible start and map to the target trim and speed. Names, comments, durations and supported host metadata are preserved; markers starting outside the target are skipped; durations may extend beyond its end. Transfers stay within the same host.

## Settings

The gear icon, top right:

- **Guide / FAQ** — this text.
- **Replay the tour**.
- **Language** — English, Russian or Spanish.
- **Library**:
  - **Save a copy…** writes the whole library — folders and analysis
    results — to a file you choose.
  - **Load a copy…** brings it back without scanning again. It adds to
    what is already there and never removes anything, so it is also the
    way to move a library to a reinstalled plugin (on another computer,
    files at other paths are dropped on the next Start scan).
  - **Clear** empties the library (click it twice to confirm): the added
    folders, every scanned sound, favorites and analyzed clips. Your audio
    files and folders on disk are never touched. Close and reopen the
    Downbeat panel afterwards.
- **Updates** — **Check now** is the first action and makes a one-time
  request even when background notifications are off. **Tell me when a new
  version is out** enables a check every three days; it does not download or
  install automatically. Analysis stays offline.
  **Open the release page** opens the new release in your browser after
  confirmation. Download the package for your operating system and install it
  with a ZXP installer yourself, then restart Premiere Pro or After Effects.
  The panel does not download packages or launch an installer.
- **Delete my data** — removes the settings, both libraries (the analyzed
  clips, and Music / SFX with their folders and analysis results) and any
  leftover temp files Downbeat saved in Documents/Downbeat, and nothing else —
  your audio files are never touched. It lists the exact files before deleting
  anything.
- **Diagnostics** — **Copy log** puts the whole log on the clipboard:
  that is the thing to send when reporting a problem.
- **About** — Give Feedback, the License, and the third-party components
  Downbeat is built on.

## In After Effects

Downbeat also runs in After Effects 2021 or newer: **Window → Extensions →
Downbeat**. Some things are more limited there — a note under the header
says so until you click **Got it** — and sound work is easier in Premiere
Pro. Otherwise it works the same way, with a layer in place of a clip:

- Select the audio layer in the composition's timeline (an audio file, or
  a video with sound). Analyze and Detect Key read that layer's file.
- **Place markers** puts layer markers on it, so they move with the layer
  — or, with **Place on: Timeline**, composition markers.
  To cut there, **J** and **K** jump the playhead to the previous or next
  marker, and **Edit → Split Layer** (⌘⇧D on Mac, Ctrl+Shift+D on Windows)
  splits the layer at the playhead.
- Markers always go on the start of the frame the beat begins in: After
  Effects has no Show Audio Time Units, and its playhead and Split Layer
  work in whole frames, so there is no Timing setting (or Shift) here.
- Constant positive Time Stretch is supported: analysis uses the source
  audio and markers are mapped to the stretched layer. Negative Stretch and
  Time Remap are refused because they need a different time mapping.
- Marker colors use After Effects' label colors: D Green, b Blue. An After
  Effects marker has one text, which shows the short label; the longer
  explanation Premiere keeps in the marker's comments is not added.
- **Copy/paste markers** works between layers, in the same or another
  composition.
- **Pitch the clip** puts the pitched layer right above the layer it was
  made from and switches that layer's sound off; a sound from the Library
  goes in as a new layer on top, at the current time.

## FAQ

**Why did the downbeat detector pick the wrong beat as "1"?**
Which beat is "one" is the hardest part of beat tracking, and no method
always gets it right. Downbeat uses two detectors and a set of checks, and
the preview lets you hear the result. If it is off, **The "1" is beat 1 2 3
4** fixes it in
a second, with no need to analyze again.

**Why is a marker's timing slightly different from what I expected?**
Detected beat times come from real, imperfect audio. If the track has a
truly steady tempo and you know its exact BPM, type it in **Custom BPM**
and click **Use**: that places an exactly even grid. Detected markers are
evened out along the track's tempo line as well (next question); if a whole
track sits a few ms early or late, **Shift − / +** lines it up.

**Do markers land exactly on the beat, or on a video frame?**
Beat detectors tend to mark a beat a few milliseconds after the hit
starts; Downbeat corrects for it: a marker sits at the start of the hit
or a hair before it, rather than after. The second detector reports
beats in 20 ms steps, so on its own each marker could sit up to 10 ms
either side of its beat; Downbeat evens the markers out along the
track's tempo line (the beats around each one), which usually brings
them very close to the beat on music made to a steady tempo. A sudden
tempo change starts a new line, and a beat far off the line is left
where it was found. The timeline is drawn and snapped in frames (at 25
fps a frame is 40 ms), so by default each marker goes to the **start of
the video frame the beat begins in**: a cut there lands on the beat or
up to one frame before it, never after. To cut between frames instead,
pick **Timing → Exact** and turn on **Show Audio Time Units** in the
Timeline panel menu (☰ next to the sequence name): the ruler then counts
audio samples, and you can cut at the exact beat. A script cannot switch
that mode on for you. Where a hit "starts" in a full mix differs a
little from track to track (a bass or pad can lead the drums by a few
ms), so a whole track can still sit a few ms early or late: zoom in on a
marker and use **Shift − / +** to line that track up.

**Does this tool assume 4/4 time?**
Yes — there is no time-signature detection. On a track that is not in 4/4,
the downbeat pick can look confidently wrong rather than uncertain;
Type: Bars + beats is a safer choice there.

**Is my audio or project data ever uploaded anywhere?**
No. Analysis and the Library run entirely on your machine. The only
network request is the update check (**Check now**, or the optional
notifications), which asks GitHub for the latest release and sends nothing
about your audio or projects.

**Where does Downbeat keep its data, and how do I remove it?**
In the folder Documents/Downbeat: your settings, the library (which folders
you added and what each file analyzed to — never the audio itself), and
short-lived temp files used during analysis (each one is deleted as soon as
its analysis finishes). **Settings → Delete my data** removes exactly those
files and nothing else; if you put anything of your own in that folder, it
stays. Uninstalling the plugin does not touch Documents, so press Delete my
data first if you want everything gone.

Each file is saved by writing a new copy and swapping it in, so a crash or a
full disk mid-save leaves the previous version whole. If a saved file still
cannot be read, Downbeat keeps it as `<name>.unreadable-<date>-<time>.json`
next to it, says so on the Library tab and starts that part empty — it never
saves over it. Premiere Pro and After Effects can run Downbeat at the same
time: each panel takes in what the other saved before saving its own changes;
after Delete my data in one, the other panel empties itself instead of saving
the old data again. Analyses of songs on a disconnected drive are kept until
the drive is back.

**Is Downbeat free? Can I see the source?**
Yes to both. Downbeat is free software under the GNU AGPL-3.0 (Settings →
License has the full text), which lets you use, study, share and change it.
The full source code is on GitHub, and the installed plugin's files are
plain, readable code.

### Metronome audio

After analysis, **Add metronome track** creates a mono 44.1 kHz WAV from the
current beat grid, with an accent on each downbeat. It uses the detected
beat times, the chosen phase and grid adjustments, with the selected clip's
trim and constant speed. It starts with the selected music, not the playhead.
In After Effects it goes on a new layer directly below the music. In Premiere
it uses an unlocked audio track below the music with room for the entire WAV;
add a track if none is free. The original music remains audible. If insertion
fails, the status shows the saved WAV's path. The limit is 30 minutes.

**Settings → Finished audio** chooses Documents/Downbeat/processed,
Downbeat/processed beside the saved project, or a custom folder. Save the
project before using the project option. This changes only newly generated
WAVs; existing files are not moved or overwritten. Libraries, settings and
temporary files stay in Documents/Downbeat. Delete my data keeps the WAVs.
Pitch and Reverse use host clip parameters and do not render audio copies.

Logs include local file paths. Review the log before sharing it publicly.

Saved track entries with invalid tempo or beat data keep usable key metadata, but their beat grid must be analyzed again.

Tempo correction belongs to the analysis that started it. If you select another clip or start a new analysis while a correction is running, its delayed result will not replace the current grid.

Cached results are checked against file size and modification time. Replacing the file invalidates its results; results saved by an earlier version are kept and take the file's size and date on first use. Changes during analysis are rejected.

### Analysis scope and source override

In Key, choose **Whole file** or **Selected clip**. Selected clip analyzes only
its source in/out interval; changing the trim uses a separate result. This does
not change beat analysis or the preview. Speed is shown separately. Very short
or musically mixed intervals can give unreliable keys.

Key overrides are saved for the chosen file/interval. **Use detected key**
restores the latest automatic answer. Replacing audio resets its analysis and
key overrides; size/mtime checks cannot detect changes that preserve both
attributes.

For Music of at least two minutes, chord analysis runs only when the profile
vote and S-KEY differ. Agreement guarantees the same final key under the voting
rule, so that extra pass is skipped. The confidence line then describes two
opinions, never three. Short clips and sound effects retain the full pass. A
missing S-KEY or failed extra worker falls back to the full pass. This saves work
on agreeing tracks; disagreeing tracks can take longer. Identical constrained BPM passes reuse their result only on
the same decoded samples and tempo limits; failures are retried.

**Pitch the clip** sits beside the semitone/cents/speed readout and wraps below
it in a narrow panel.

### Tour and support log

Replay the tour includes metronome tracks, key scope and saved values, Pitch the clip, output folders and release-page updates. To report a problem, reproduce it in the current session, then use Settings → Diagnostics → Copy log and send it with the steps and a screenshot. The log contains plugin/host versions and runtime errors; it is not an automatic test and nothing is sent online. Local file paths may appear: review them before sharing.

### Source key and timeline pitch

Detect key measures the source file or its selected source interval. Pitch the clip changes playback speed without rewriting that file: an A-minor source remains 8A, while +2 semitones plays as B minor, 10A. The Source key result stays unchanged; Timeline key (calculated) shows the timeline key at the selected clip speed. Speed changes refresh that view. Audio effects and pitch-preserving stretch are not measured from the file.

After Pitch the clip succeeds, the new clip/layer is selected automatically, so another Detect key uses its playback speed. If the host cannot confirm selection, the panel asks you to select it manually. Copy log records the selected clip speed; detector messages still describe source audio.

The main result is Timeline key (calculated). Its wheel, compatible keys, Match clip and In key follow the selected clip's current speed. Source key and source overrides keep the file's original key. Pitch the clip composes each shift with the existing speed: +2 followed by another +2 gives 125.99%, and shifting back restores 100%. The speed shown in the calculator is the final clip speed; BPM goes from current playback to the new playback. If selection or speed changes before insertion, review the updated plan and click again. Between-semitone speeds have no exact key for matching or automatic pitch. Maintain audio pitch and pitch effects are outside this calculation.

Pitched copies discard inherited Downbeat clip/layer markers. Premiere uses a separate project item so clearing the copy cannot clear the original. Editor markers on the original and sequence/composition markers remain unchanged. Analyze and place fresh markers for the new playback speed.

Library Add sets the selected region directly on the inserted Premiere clip with Time values, then checks the source start and duration before applying fades, pitch or reverse. This avoids frame-rounded project-item In/Out boundaries. A refused trim still removes the insertion.
