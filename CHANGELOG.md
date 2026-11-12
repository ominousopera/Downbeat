# Changelog

Release notes and packages for every version are on the
[Releases](https://github.com/ominousopera/Downbeat/releases) page.

## 1.0.6

### Markers

- Downbeat's markers belong to their clip. Place and Clear leave the markers
  of other clips alone, and Clear reaches every piece of a clip that was
  cut.
- After Effects with a non-English interface handles layer markers the same
  way as in English.
- After a cut made exactly on a marker (Razor in Premiere Pro, Split Layer
  in After Effects), placing markers on the left piece again keeps the right
  piece's first marker.
- Paste is much faster on long songs: a few hundred markers take seconds,
  not half a minute.

### Analyze

- The "1", **Beat grid** (Refined / Basic) and the Undo of **Custom BPM**
  stay after a trim or after the clip is selected again.
- A **Custom BPM** grid counts from the clip's start and follows a clip that
  was made longer.
- Audio that is too short or silent is refused with a message that says so.
- A song analyzed before shows its tempo and beat grid again after the
  program is restarted, and a song analyzed in the other program shows them
  too, without a new **Analyze**.

### Pitch and inserts

- A muted track counts as busy, so nothing is placed on it.
- Media with picture goes in as audio only, and media with several audio
  channels is placed only where all its tracks are free.
- A clip that is switched off is refused.
- In Premiere Pro, the In and Out you set on the sound in the bin stay as
  they were, and a refused pitch change leaves nothing behind in the bin.
- After Effects carries the layer's own markers onto the pitched copy.
- After Effects names the undo steps **Downbeat: add metronome** and
  **Downbeat: change pitch**.
- In Premiere Pro a stereo sound or pitched copy is not placed on a mono or
  5.1 track: it goes to the next standard track, or the panel says that the
  free tracks there take only their own kind of clip.

### Library

- Keys are read from file names more strictly: a key taken from a title
  word or a one-letter folder name goes back to analysis. Stars stay.
- A search for a word with a hyphen or an apostrophe ("sci-fi", "don't")
  finds it, and accented names are found however the accents are stored.
- A missing file with a star or a key you set keeps its record, and a moved
  file keeps its record.
- Recycle folders on Synology and QNAP network drives are skipped.
- A star set in one program while the other one scans is kept in both.
- After **Clear** in the other program, the line under the list says the
  library was cleared there instead of keeping its old text.
- **Clear** ignores a double click, and one click inserts a sound once.
- Shortcuts are ignored while a dialog is open and work after a click in
  the Library.
- FLAC and OGG files can be listened to but not inserted: the panel says so
  instead of Premiere Pro showing its own "File format not supported"
  dialog.
- A scan with a folder on an unplugged drive ends with its normal summary
  instead of "could not be fully read".

### Saved data

- **Delete my data** keeps only the language and whether you saw the tour,
  and a double click does not answer its dialog.
- With Premiere Pro and After Effects open together, **Shift** values and
  the record of placed markers are merged song by song.
- A failed save stays visible until a save succeeds, and **Save a copy**
  writes a temporary file first and then renames it.

### Background work and messages

- Temporary audio goes to the system's temp folder.
- The analysis workers start hidden on Windows, stop when the panel closes
  and end at their own time limit.
- Analysis failures and the host's refusals are short sentences in the
  panel's language; the full text stays in the log.
- A layer whose media file is missing says so instead of "has no audio",
  and the clip line shows the reason for a newly selected layer even while
  an earlier error is on screen.
- The hint under **Settings → Finished audio** is in the panel's language
  right after the start.

### Panel

- **Esc** closes Settings and the dialog on top of it (**Delete my data**,
  a link, the guide) in Premiere Pro and After Effects.
- In the narrowest panel the clip line moves under its heading instead of
  being cut to its last word, **Place markers** keeps whole words, and the
  Library's search box keeps room for what you type.
- The start line ("Select an audio clip on the timeline…") is shortened at
  its end in a narrow panel instead of losing its first words.
- In the clip line a long file name is shortened first (its start stays),
  then the BPM and key after it, instead of the line being cut from the
  left.

### License

- `NOTICE.md` and the README state the current upstream terms of the S-KEY
  key model: its code is MIT, but its authors limit the model weights
  (`models/skey.onnx`) to non-commercial research use.

### Requirements

- Unchanged: Premiere Pro 2025 (25.0) or After Effects 2025 (25.0) or
  newer, macOS 13.5 or newer (Apple Silicon and Intel), Windows 10 or 11
  (x64).
- The bundled Node.js, which runs the analysis on your computer, is 24.22.3,
  the security release of November 2026.
- The ONNX runtime that runs the beat and key models is 1.31.1; on the
  test tracks it gave the same beats and keys as the one in 1.0.5.

## 1.0.5

### The "1" of each bar

- With **Beat grid → Refined**, the second detector (Beat This!) counts the
  bars over the whole song at once, so the "1" comes every four beats and
  does not jump to a loud beat 3. Silence before and after the music is left
  out of the count.
- When the second detector's beats do not pass its checks and the first
  detector's beats stay, it still counts the bars, on those beats. Before,
  the "1" there was chosen from the low end and the chords alone.
- A "1" less than a beat and a half after another one is left out, also on
  tracks analyzed earlier. No "1" is moved or added.
- When the detector is unsure where the bars start, or its "1"s still come
  at uneven distances, a warning under **The "1" is beat** says so: listen to
  the click and pick the real "1" in **1 2 3 4**, or switch **Beat grid** to
  **Basic**. The warning comes back when the track's analysis is opened
  again.

### Tempo

- The BPM now comes from the beats the markers use, so the number agrees
  with the markers (before, it could be 1-5% off while the markers were
  right, for example 91.4 for a 94 BPM song). The Library scan reads it the
  same way. Tracks analyzed earlier keep their number until they are
  analyzed again.

### Markers

- Paste in Premiere Pro adds a copied marker that differs from one already
  on the target only in color; the target's own marker stays.
- Place and Clear leave your own markers alone even when they are named D
  or b. Downbeat knows its markers by the name together with the
  explanation in the comment (Premiere Pro), or with its color and a
  "Downbeat" marker parameter (After Effects), and no length. A Downbeat
  marker whose comment or length you change becomes yours. In After
  Effects, D and b markers placed by 1.0.4 or earlier count as yours:
  delete them by hand once.
- When a clip with timeline markers was moved, placing markers on the clip
  also removes those earlier timeline markers. Downbeat remembers where it
  put them also across a restart of Premiere Pro or After Effects, so Place
  and Clear find that set after the clip moved.
- **Shift − / +** counts only with **Timing: Exact**, where it is shown. A
  shift set earlier leaves the markers alone under Frame timing and in
  After Effects.
- The reasons the host gives (nothing selected, a video clip, two clips, no
  sequence, Time Remap on a layer) are shown in the panel's language.
- Copy and Paste keep the address of a Web Link marker in Premiere Pro.

### Library

- A star is saved at once, so closing the panel right after it keeps it. A
  star set in the other program shows here after the next save and comes
  off with one click. A star here keeps what the other program did to that
  sound meanwhile (its analysis, a confirmed key).
- The search finds names in any letters (Polish, Czech, Greek, Ukrainian,
  Japanese, Arabic and others), one-letter words, and folder names at any
  depth below the folder you added. Before, the first letter typed did not
  update the list, and only the last three folders of a path were searched.
- A held Space leaves the preview alone; one press starts or stops it.
- A scan that reaches its limit of 50,000 files says so.
- When the project's copy of a sound is offline (its drive was away while
  the project was open), Insert imports the file again and places a working
  clip, not a Media Offline one. If Premiere Pro still keeps it offline, the
  panel says so and places nothing.
- Why an insert was refused (no free audio track, an offline or missing
  file and the rest) is shown in the panel's language.

### Panel and texts

- The in-panel Guide shows the sub-points of a numbered step under that
  step, not as steps of their own.
- The tour numbers its steps with no gap. Its buttons are two even rows
  in every language: Back and Next, and Skip under them; nothing sticks
  out past the edge.
- **Beat grid** shows the right word on a clip selected again, and
  switching it there works: when the other grid is not at hand, the clip
  is analyzed again first. A track analyzed in an earlier session
  shows no grid warning and no Beat grid switch until it is analyzed.
- Check now with background checks off says only that the check failed,
  and with no internet connection it says so in words.
- Delete my data describes the other items in Documents/Downbeat
  (finished audio in processed/ among them) as left as they are.
- A file too long for Analyze (it manages about 30 minutes) gets a message
  that says so instead of a technical error.

### Key

- **Use detected key** sits next to **Detect key** and shows only when the
  selected clip's key was set by hand, also right after the panel opens.
- **Pitch the clip** in Premiere Pro puts the project items of pitched clips
  into one "Pitched audio" bin inside the Downbeat bin instead of a new bin
  for each.

### Requirements

- Premiere Pro 2025 (25.0) or After Effects 2025 (25.0) or newer. Earlier
  versions do not show this panel; 1.0.4 stays on the Releases page for
  them.
- macOS 13.5 or newer (Apple Silicon and Intel) and Windows 10 or 11 (x64),
  as the bundled Node.js requires. Windows on Arm is not supported yet.
- The bundled Node.js, which runs the analysis on your computer, is 24.22.1,
  the security release of October 2026.

### Saved data

- When another program holds a data file and Windows refuses a save, the
  complete new data is kept next to it as
  `<name>.unsaved-<date>-<time>.json` and taken in at the next start. A file
  cut short by a failed save is set aside and replaced by that copy. The
  copies are removed only after the panel that holds their data saves
  successfully, and by Delete my data.
- A data file that cannot be read is copied aside instead of moved, so the
  other host never takes the moment without the file for Delete my data.
- With Premiere Pro and After Effects open together, settings are merged
  setting by setting: a change made in one host is kept when the other one
  saves, also when both save at the same moment.
- Delete my data in one host is noticed by the other one also when it first
  shows in the settings file (a language change there keeps the deleted
  analyses deleted) and when that panel started from kept copies.
- A save that fails on a full disk removes its cut-short temp file at once.
- The support log names the data files without the user's home path.

## 1.0.4

### Saved data and markers

- Data files are written as a new copy and swapped in, so an interrupted
  save keeps the previous version. A file that still cannot be read is kept
  as `<name>.unreadable-<date>-<time>.json`, reported on the Library tab and
  never saved over.
- Premiere Pro and After Effects can run Downbeat together: each panel takes
  in the other's newer saves (favorites, confirmations, folders, settings)
  instead of overwriting them, and the start-up clean-up removes only
  temporary files older than six hours.
- Settings → Clear empties the whole library (folders, scanned sounds,
  favorites, analyzed clips) and asks to reopen the panel; audio files on
  disk are never touched.
- The Library's Key/BPM confirmation panel and the "move markers" option are
  gone: copying markers never removes anything.
- After Effects: placing or pasting markers leaves your own marker where a
  beat falls on the same moment. Premiere: placing again on a re-sped clip
  replaces the whole earlier set.
- Enter in the Library inserts a sound once, however long it is held.
- A Library insert in Premiere checks the free space for the file's real
  length, also for a sound whose key and tempo come from its name; when the
  length is unknown nothing is placed.
- Analyzed songs on a disconnected drive are kept until it is back, and
  analyses saved by earlier versions survive the update.
- Pasting markers onto the same song in another sequence adds no second set;
  After Effects inserts a video file's sound without its picture; Russian and
  Spanish words to leave out work in the Library search.
- Placing timeline markers on one use of a song keeps the markers of its
  other uses in the same sequence or composition. Pasting keeps markers that
  differ only in length.
- A data file that briefly cannot be read (a network or cloud Documents
  folder) is never taken as deleted: nothing is cleared, and that save waits
  for the next change. Delete my data in one host stays done in the other one,
  even after new data was saved there.

### Metronome track

**Analyze → Add metronome track** renders the current beat grid as a mono
44.1 kHz WAV with accented downbeats and places it below the selected music.
Trim, constant speed, the beat phase and grid adjustments are included. In
Premiere, an unlocked audio track below the music needs room for the whole
click track; add one if needed. The WAV stays on disk if the insert fails.
Up to 30 minutes.

### Where new audio goes

**Settings → Finished audio** chooses Documents/Downbeat/processed,
Downbeat/processed next to the saved project, or a folder of your own.
Settings, libraries and temporary analysis files stay in Documents/Downbeat.
Existing audio is never overwritten, and Delete my data keeps the WAVs it
made. Pitch and Reverse are set on the clip; no audio copy is rendered.

### Key: source and timeline

- Detect key measures the source audio, for the whole file or only the
  selected clip's in/out interval. **Source override** saves a key you know;
  **Use detected key** brings the analysis back.
- The main Key result, Camelot wheel, compatible keys, Match clip and In key
  use the key the selected clip plays at, worked out from its speed: A minor
  (8A) at +2 semitones plays as B minor (10A). Maintain audio pitch and pitch
  effects are not taken into account.
- Pitch the clip starts from the clip's current speed, so two +2-semitone
  shifts give +4 (125.99%), and selects the new clip afterwards. If the
  selection or speed changed before the click, check the new plan and click
  again.
- In Premiere the pitched clip is a separate item without Downbeat's clip
  markers; your own markers and the original's stay. Analyze and place
  markers on it again.
- Results are tied to the file's size and date: replacing a file clears its
  analysis and key overrides.
- Long music tracks skip the chord pass when the profile vote and S-KEY
  agree; the final key is the same.

### Library and markers

- A selected part of a Library sound is trimmed exactly on the inserted
  Premiere clip; if the host refuses the trim, the insert is taken back.
- Copied markers keep their place relative to what you hear, follow the
  target's trim and speed, and keep comments and length within one host.
- Music and SFX folders must not overlap. Start scan retries failed files,
  folders that cannot be read keep their records, and a replaced file
  reloads its preview.

### Tour and support

Replay the tour covers the metronome, key scope, Pitch the clip, the audio
folder and updates. For support, copy the session log from **Settings →
Diagnostics** and send it with the steps and a screenshot; the log has local
file paths, so look through it first.
