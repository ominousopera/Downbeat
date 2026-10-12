# Changelog

Release notes and packages for every version are on the
[Releases](https://github.com/ominousopera/Downbeat/releases) page.

## 1.0.5

### The "1" of each bar

- With **Beat grid → Refined**, the second detector (Beat This!) counts the
  bars over the whole song at once, so the "1" comes every four beats and
  does not jump to a loud beat 3. Silence before and after the music is left
  out of the count.
- A "1" less than a beat and a half after another one is left out, also on
  tracks analyzed earlier. No "1" is moved or added.
- When the detector is unsure where the bars start, or its "1"s still come
  at uneven distances, a warning under **The "1" is beat** says so: listen to
  the click and pick the real "1" in **1 2 3 4**, or switch **Beat grid** to
  **Basic**. The warning comes back when the track's analysis is opened
  again.

### Markers

- Paste in Premiere Pro adds a copied marker that differs from one already
  on the target only in color; the target's own marker stays.

### Key

- **Use detected key** sits next to **Detect key** and shows only when the
  selected clip's key was set by hand, also right after the panel opens.

### Requirements

- Premiere Pro 2025 (25.0) or After Effects 2025 (25.0) or newer. Earlier
  versions do not show this panel; 1.0.4 stays on the Releases page for
  them.
- macOS 13.5 or newer (Apple Silicon and Intel) and Windows 10 or 11 (x64),
  as the bundled Node.js requires. Windows on Arm is not supported yet.

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
  saves.
- Delete my data in one host is noticed by the other one also when it first
  shows in the settings file (a language change there keeps the deleted
  analyses deleted) and when that panel started from kept copies.

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
