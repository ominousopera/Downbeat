<p align="center">
  <img src="docs/images/logo.svg" alt="Downbeat" width="72">
</p>

<h1 align="center">Downbeat</h1>

<p align="center">
  <b>All you need to speed up the sound design of your videos, in one plugin.</b>
</p>

<p align="center">
  <a href="https://github.com/ominousopera/Downbeat/releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/ominousopera/Downbeat?style=flat-square"></a>
  <img alt="license AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-4c8bf5?style=flat-square">
  <img alt="Premiere Pro 2021+" src="https://img.shields.io/badge/Premiere%20Pro-2021%2B-9999ff?style=flat-square">
  <img alt="After Effects 2021+" src="https://img.shields.io/badge/After%20Effects-2021%2B-cf96fd?style=flat-square">
  <img alt="macOS Apple Silicon and Intel" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%C2%B7%20Intel-30b0c7?style=flat-square">
  <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat-square">
  <img alt="works offline" src="https://img.shields.io/badge/works-offline-e0a339?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/ominousopera/Downbeat/releases/latest"><img src="docs/images/download-mac.svg" alt="Download for macOS" height="52"></a>
  &nbsp;
  <a href="https://github.com/ominousopera/Downbeat/releases/latest"><img src="docs/images/download-win.svg" alt="Download for Windows" height="52"></a>
</p>

<p align="center">
  <sub>The analysis is an estimate: listen to the click track, and fix the tempo or the "1" in one click.<br>
  User guide:
  <a href="GUIDE.md">English</a> &middot;
  <a href="GUIDE.ru.md">Russian</a> &middot;
  <a href="GUIDE.es.md">Spanish</a></sub>
</p>

<p align="center">
  <img src="docs/images/hero-three-cards.png" alt="Downbeat: find the beat, match the key, find the sound" width="100%">
</p>

## Why editors use it

**Working with music in a video edit is three jobs:** getting the timing
right, getting the harmony right, and finding the right sound. Downbeat does
all three in one plugin inside Premiere Pro and After Effects, for every kind
of edit: vlogs, reels and shorts, music videos, weddings and events, trailers,
ads, documentaries, game montages.

| 01 · TIMING | 02 · HARMONY | 03 · SOUND |
|---|---|---|
| **Find the beat**<br>Tempo, beats and the strong beat of every bar, placed as markers. Clips snap to them, so cutting many video clips to one track is fast and lands on the downbeat once the detection is right. | **Match the key**<br>The musical key of every track (Camelot and note names) and the keys that blend with it. Make transitions between songs that fit, or pitch one into the key of the other, so they clash less. | **Find the sound**<br>Your own music and sound effects, searchable by **key, tempo and sound type** without leaving the app. Pick the clip you are cutting, press Match clip, and see what fits. |

**One workflow:** analyze the track, check its key, find music and effects
that fit, drop them on the timeline.

**Not only on the beat.** Cutting on the beat is half of it. For a series of cuts
and sounds to play as one track, their notes have to fit as well: a hit or a
riser in the wrong key breaks the montage into separate pieces, in the right
key it sounds like one piece. Downbeat shows the key of every clip and sound,
so you can pick the ones that match, or pitch one into the key of the other.

### Without Downbeat and with it

| | Without Downbeat | With Downbeat |
|---|---|---|
| **Finding the tempo** | Tap along, count by ear | Analyze gives the BPM, beats and downbeats in seconds |
| **Cutting on the beat** | Nudge every cut by eye and ear, frame by frame | Markers on every bar or beat; clips snap to them |
| **Knowing a track's key** | Guess by ear or open a separate app | Detect key shows it in Camelot and note names, with the keys that fit |
| **Moving between two songs** | Trial and error; a clash shows up late | Pick keys that blend, or pitch one clip into the key of the other |
| **Finding a sound** | Search by file name, scroll folders, audition one by one | Search by key, tempo and category (type "swoosh", find your whooshes); **Match clip** shows only what fits |
| **A riser or hit in the right key** | Pitch it in another tool, export, import again | Preview with pitch, reverse and fades, then insert |
| **Getting it on the timeline** | Leave the app and drag files around | One click at the playhead, as your original file |

Free, offline and private: nothing is uploaded, and your original files are
never changed.

## What it does

<p align="center">
  <img src="docs/images/analyze.png" alt="The Analyze tab: waveform with beat markers, 124 BPM, marker settings" width="400">
  <img src="docs/images/key.png" alt="The Key tab: Camelot wheel, detected key 8A, pitch shift of -5 semitones" width="400">
</p>

### Analyze

Finds the tempo, beats and downbeats with two detectors (a classic algorithm
and the Beat This! model, which runs locally) and puts markers
where it hears them, so you can cut there; check them with the click track. Then Premiere does the rest: with snapping on
(<kbd>S</kbd>), the Razor tool (<kbd>C</kbd>) snaps to the markers, so cutting
to the beat takes minutes.

Check it by ear: press play, listen to the click on every downbeat, and fix
what is off. See [Known limits](#known-limits).

- **Bars or Bars + beats.** One marker on the "1" of every bar for a calm,
  strong-beat edit, or on every beat, with each downbeat kept apart, for a fast
  one. Switch any time; placing again replaces the old markers and never
  touches yours.
- **On the clip or on the timeline.** Clip markers travel with the clip when
  you move or trim it; timeline markers stay in the sequence.
- **Frame-accurate by default.** Each marker sits at the start of the video
  frame the beat begins in, so a cut lands on the beat or up to one frame
  before it, never after.
- **Sample-accurate marker timing in Premiere Pro.** Choose **Timing → Exact** and turn on
  **Show Audio Time Units** in the Timeline panel menu: the ruler then counts
  audio samples and you can cut between frames, right on the beat.
  **Shift − / +** nudges a whole track 1 ms at a time.
- Half / double tempo fix, pick which beat is the "1", or type your own BPM;
  a click track lets you check it by ear.
- **Refined / Basic.** If the markers miss the beats, switch between the two
  detectors' results with one click.
- **Copy and paste markers** within the same host (copying never removes
  anything from the source). Positions use
  the audible clip start and adapt to target trim/speed; comments, duration and
  supported metadata are preserved.
- **Add a metronome track.** Render the current grid as a WAV and insert it below
  the selected music; choose the finished-audio folder in Settings.

### Key

Musical key in Camelot and note names. For music three analyses vote; for a
riser or a hit, pick **Sound effect** and the analysis is tuned for short
sounds (there the key is a hint). A pitch shift calculator gives semitones,
cents and speed for your own pitch shifter, and **Pitch the clip** retimes the
clip itself to another key, like a sampler. Your audio is never rewritten.

- **Whole file or Selected clip.** Detect the key of the whole song, or only
  of the part the clip uses.
- **Timeline key.** The big result, the wheel, the keys that fit, Match clip
  and In key use the key the clip plays at on the timeline, worked out from
  its speed. The file's own key stays visible as **Source key**.
- **Source override.** Type the key if you already know it; **Use detected
  key** brings the analysis back.
- **Pitch the clip** starts from the clip's current speed, so two +2 shifts
  give +4. The pitched clip starts without Downbeat's markers (analyze it
  again); your own markers and the original's stay.

### Library

Your own music and sound effects, with the key of every file written right
next to it. Pick the song you are cutting, press **Match clip**, and the list
shrinks to the sounds that fit it.

<p align="center">
  <img src="docs/images/library-match.png" alt="The Library with Match clip on: only sounds in the song's key or a neighbouring one" width="400">
  <img src="docs/images/library-preview.png" alt="The Library preview: pitch a sound into the song's key, trim it, add fades" width="400">
</p>

- **Key and tempo on every file**, like `8A · A minor` or `124 BPM`, found
  when you scan your folders.
- **How sure the key is, in words.** A music key comes from three methods. The
  row says *key agreed* when at least two of them gave it, and *key uncertain*
  (in red) when all three differed, so you know which ones to check by ear.
- **Names that already say the key.** Many sample packs put it in the file name
  (`Pad Amin`, `Bass Fm 128 BPM`, `Key Emaj`, `8A - 128 - …`). Downbeat reads it, trusts it
  over its own guess, and marks the row *from the file name*, so you know which
  keys come straight from the pack. A file whose name gives everything (the key,
  plus the tempo for music) is ready instantly, with no analysis.
- **Not every sound effect has a key.** Most whooshes, footsteps, wind
  or rain are noise, not notes: they show "no clear pitch" and a key search
  skips them. Only tonal sounds (risers, drones, stingers, pads, bass hits)
  get a key, and even then it is a hint to check by ear.
- **Match clip** shows only the sounds in the same or a neighbouring key (and
  the same tempo for music), so you stop auditioning files that clash.
- **Search by sound type.** Type "swoosh" and it finds your whooshes, because
  it knows the sound-effect categories and their synonyms.
- **Filters and shortcuts.** Filter by key (exact or compatible) and by BPM
  (a range, also half and double tempo), show only favorites (★) or only
  pitched sounds, sort by match, name, length or tempo. After a click on a
  row, Space listens and Enter inserts.
- **Folders you can scope.** Tick folders to search only those. Files that are
  not there any more are marked, not forgotten, and **Settings → Library →
  Save a copy / Load a copy** backs the whole library up. Music and SFX use
  separate, non-overlapping audio folders; a whole drive, card or network share
  can be added, the system disk cannot. Unreadable
  folders retain records and favorites; Start scan retries failed files.
- **Preview in the panel** with play, loop, reverse and volume. Drag across the
  waveform to pick just a part of the sound, and drag the fade handles to add
  a fade in and a fade out.
- **Pitch it up or down** by up to 12 semitones, like a sampler (higher is also
  faster and shorter). The panel tells you the new key:
  `6A G minor → 8A A minor`. Or press **In key** and every sound you listen to
  is already pitched into your song's key.
- **Add at the playhead** as your original file. The trim, fades, pitch and
  reverse are set on the clip, and no processed copy of your audio is ever
  written.

## Install

1. Download the `.zxp` for your system (`-mac` or `-win`) from the
   [latest release](https://github.com/ominousopera/Downbeat/releases/latest).
2. Drag it onto [ZXP Installer](https://aescripts.com/zxpinstaller/) (free),
   restart Premiere Pro or After Effects, then open
   `Window > Extensions > Downbeat`.

Signed with a self-signed certificate: no Terminal commands and no
`PlayerDebugMode`. Each package carries only its own platform's Node.js; the
wrong one says so when you press Analyze. To remove Downbeat, use Remove in the
ZXP installer. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

Build from source: see [DEVELOPMENT.md](DEVELOPMENT.md).

<details>
<summary><b>Privacy and security</b></summary>

Everything runs on your computer. The panel makes no network calls except the
explicit release checks and optional background notifications (off by
default), and `scripts/check-code.js` fails the build if any other code that
could is added. Saved data
(settings, track library, temporary files) lives in `Documents/Downbeat`,
never inside the plugin's own folder. Report a vulnerability privately through
the repository's Security tab; see [`SECURITY.md`](SECURITY.md).
</details>

## Known limits

**The analysis is automatic, so check it by ear.** Downbeat estimates the
tempo, beats, bars and key from the audio, and it can be wrong, especially
on tracks with a changing tempo, a weak or unusual beat, a long quiet intro,
a time signature other than 4/4 (see below), or very short sounds. Press play
on the click track and listen. If something is off, fix it: half / double
tempo, the beat that is the "1", **Shift**, or set the key by hand
(**Source override**). The key of a sound effect is only a hint, because many
effects have no clear pitch. **Match clip** and **In key** give you a
shortlist to audition, not a promise that two sounds will blend.

- **Time signature.** Downbeat assumes four beats to a bar. On a track that is
  not in 4/4 the bar markers can be wrong; use **Bars + beats** there.
- **Tempo changes inside a track.** The panel shows one BPM. The markers follow
  the beats it finds and a sudden change starts a new tempo line, but check
  such tracks with the click track.
- **Sound effects.** No tempo is detected for them, and many have no clear
  pitch, so they get no key. The key of a tonal effect is a hint, and sounds
  shorter than 10 seconds get a note that it is less reliable.
- **File formats.** Analyze reads WAV, AIFF, MP3, M4A / AAC and the audio of
  MP4 / MOV; other formats need converting first. Files your host cannot import
  (for example FLAC and OGG in Premiere Pro) can be scanned and previewed in the
  Library, but not inserted.
- **After Effects.** Downbeat is built around Premiere Pro, where every feature
  is available. After Effects 2021 and up has a smaller set:
  - Markers go on whole video frames only: no sample-accurate **Exact** timing
    and no **Shift**.
  - Constant positive Time Stretch is supported for analysis and markers.
    Reversed layers and Time Remap are refused.
  - You cut at the markers by hand with **J / K** and **Split Layer**; there is
    no Razor tool snapping to them.
  - A marker keeps only its short label.
  - Library sounds are added as a new layer; fades become volume keyframes,
    and pitch and reverse are set through Time Stretch.

## FAQ

### Why it matters

<details>
<summary><b>Why cut on the beat, and why match the key?</b></summary>

A cut off the beat feels wrong even when you can't say why; on the beat, the
clip just feels right. The notes have to fit too: pieces in the same or a
neighbouring key sound like one track. Downbeat marks the beat and shows the
key, so you can pick both.
</details>

<details>
<summary><b>How do I cut music so the edit can't be heard?</b></summary>

Stay on the beat, cut on a downbeat, keep the phrases (often 4, 8 or 16 bars),
use a riser or fill the song already has for a fade, and add a very short
crossfade so the join doesn't click. Downbeat's markers and click track help
with the first three.
</details>

<details>
<summary><b>How do DJs mix tracks, and what can an editor take from that?</b></summary>

A DJ matches the tempo of two tracks, brings the new one in on the first beat
of a bar where a phrase starts, and picks a key that fits. Do the same when you
join music in an edit: Downbeat shows the tempo, the bar markers and the key.
</details>

<details>
<summary><b>How do I join two different songs?</b></summary>

Check the tempo and the key: close tempos keep the pulse, and the same or a
neighbouring key on the Camelot wheel blends. Analyze and Detect key give you
both; for your own music, **Library → Match clip** lists the tracks that fit.
Phrases and mood still matter.
</details>

<details>
<summary><b>Why use sound effects that are in key?</b></summary>

Risers, booms, stingers and drones carry a note. If it doesn't fit the key of
the music, the effect sounds off even on the beat. The Library shows the key of
every tonal effect, lists the ones that fit (**Match clip**) and can pitch one
into the key (**In key**).
</details>

<details>
<summary><b>Why do I need a plugin for this?</b></summary>

Most editors find the tempo, the bars, the key and the right sound by ear, by
tapping along or in separate apps, and it eats time. Downbeat does it in one
plugin, and you don't need any music theory.
</details>

### Using Downbeat

<details>
<summary><b>Where does Downbeat fit in a typical project?</b></summary>

A common way to work on a motion design or edit project: cut the music in
Premiere Pro first and build an animatic (it shows the client the pacing:
where the video speeds up, pauses or changes mood), animate in After Effects,
then come back to Premiere Pro for the sound design and the mix.

- **Cutting the music:** Analyze puts markers on the bars and beats, the
  click track lets you check them, and Detect key with the Library helps you
  pick a second song that fits.
- **Sound design:** the Library finds sound effects by type and key, plays
  them already pitched into the song's key, and adds them at the playhead.

Premiere Pro is the better place for the music work: besides its audio mixer
and VST plugins it has **Show Audio Time Units**, which lets you cut audio
between video frames, down to single audio samples.
</details>

<details>
<summary><b>How does the analysis work?</b></summary>

Everything runs on your computer; nothing is sent anywhere.

**Tempo, beats and bars.** Two detectors listen to the same audio. The first
is a classic beat tracker from the open-source
[essentia](https://essentia.upf.edu/) library, which finds the tempo and the
beats. The second is **Beat This!**, a small neural network that finds beats and
downbeats (the first beat of each bar). Downbeat uses the network's result only
if it passes checks against the first one (for example, it must not hear the
track at half or double speed); otherwise the classic result stays. With the
classic detector the first beat of a bar is chosen by weighing the low-end
energy and the chord changes at each beat; with the network it comes from the
network itself. The beat times are then evened out along the local tempo line,
corrected for the detectors' delay, and every marker is placed at the start of
the video frame its beat falls in (or at the exact time, in Premiere Pro with
**Timing → Exact**).

**Key.** Three independent analyses vote: classic key profiles (essentia), the
chord progression, and **S-KEY**, a small neural network trained on music. The
profile vote stands unless the chord analysis and S-KEY agree with each other on
a different key; then theirs wins. Sound effects use another setup (a longer
analysis window and no S-KEY, which is trained on music).

**Library scan.** To stay fast the scan reads part of each file. It finds the
key and, for music, the tempo, and it decides whether a sound effect has a clear
pitch at all. A key or tempo written in the file name is used as it is.

The result is an estimate, not a measurement: see [Known limits](#known-limits). The
components and their licenses are listed in [`NOTICE.md`](NOTICE.md).
</details>

<details>
<summary><b>Does it work offline? Is anything uploaded?</b></summary>

Analysis and Library work offline. Nothing is uploaded, there is no account
and no analytics. **Settings → Updates → Check now** makes a one-time GitHub
request. Optional notifications check every three days; they are off by
default. **Open the release page** opens the new release in your browser
for manual download and installation with a ZXP installer. Restart the
Adobe app afterwards. The panel does not download or install packages.
No personal content is sent (GitHub sees your IP
address, as any website does). Feedback and release-page links open in your
browser after a confirmation.
</details>

<details>
<summary><b>Does it change my audio files?</b></summary>

No. Your files are never modified, and no processed copy of them is written.
Sounds go on the timeline as your original file, with the trim, fades, pitch
and reverse set on the clip itself. Downbeat writes settings, the track library
and short-lived temporary files in <code>Documents/Downbeat</code>;
<b>Settings → Delete my data</b> removes them. Generated metronome WAVs use
the <b>Finished audio</b> destination and are kept by Delete my data.
</details>

<details>
<summary><b>Which key does Pitch, Match clip or In key use?</b></summary>

They use the selected clip's calculated playback key. Detect key measures the
source file or selected source interval; source overrides stay attached to that
source. Speed changes pitch like a sampler, so two +2-semitone shifts combine
into +4. Maintain audio pitch and audio effects are outside this calculation.
At speeds between whole semitones there is no exact Camelot target.
</details>

<details>
<summary><b>How do I copy markers from a trimmed clip?</b></summary>

Use Marker tools → Copy markers, select the target, then Paste markers here.
Copying never removes markers from the source. Transfer
uses audible offsets rather than absolute source time, preserves supported
metadata in the same host, and skips starts outside the target clip. A duration
can extend past the clip end. Changing the selection or timing during a host
request refuses the operation before anything changes.
</details>

<details>
<summary><b>What is the Camelot wheel?</b></summary>

A DJ notation for the 24 musical keys: numbers 1 to 12 around a wheel, and a
letter, <b>A</b> for minor and <b>B</b> for major, so <code>8A</code> is A minor
and <code>8B</code> is C major. Keys next to each other on the wheel (one
number up or down with the same letter, or the same number with the other
letter) blend well. Downbeat shows the Camelot code next to the note name and
lists the keys that go well with the one it found.
</details>

<details>
<summary><b>Which sounds can I put in the Library?</b></summary>

Any folder with audio files (WAV, AIFF, MP3, M4A, AAC, FLAC, OGG), added as
<b>Music</b> or <b>SFX</b>. A scan reads the key and, for music, the tempo.
Sound effects get no tempo; most of them have no pitch either, so they show
"no clear pitch" and are skipped by a key search. Files your host cannot import
(for example FLAC and OGG in Premiere Pro) can be scanned and previewed, but
not inserted. A whole drive, memory card or network share can be added (not
the system disk); keep Music and SFX folders separate. Start scan retries failed files. A folder that
cannot be read keeps its saved records; Cancel stops queued work. If a file is
replaced at the same path, its preview reloads before insertion.
</details>

<details>
<summary><b>Does it work with any time signature?</b></summary>

Downbeat assumes four beats to a bar and has no time-signature detection. On a
track that is not in 4/4 the downbeat pick can look confident and still be
wrong; **Bars + beats** is the safer choice there.
</details>

<details>
<summary><b>Do I need to cut by hand after Analyze?</b></summary>

Downbeat places the markers; you do the cutting. In Premiere Pro, with snapping
on, the Razor tool snaps to the markers, so it takes a few clicks per cut.
</details>

<details>
<summary><b>Which versions are supported?</b></summary>

Premiere Pro 2021 and newer and After Effects 2021 and newer, on macOS (Apple
Silicon and Intel) and Windows x64, with an interface in English, Russian and
Spanish. Analyze reads what the host can put on a
timeline and the panel can decode: WAV, AIFF, MP3, M4A / AAC, and the audio of
MP4 / MOV.
</details>

## Thanks

Special thanks to **Ilya Rogulev**, who tested Downbeat on Windows and
Premiere Pro and After Effects through every round of fixes: the folder
dialogs, the fades and the reversed layers on Windows all got their answers
from his logs.

Special thanks to **Vladislav Baranov** for his ideas and hints on how to
make the plugin better.

## License

AGPL-3.0, see [`LICENSE`](LICENSE). Third-party components:
[`NOTICE.md`](NOTICE.md). Guide: [English](GUIDE.md) ·
[Russian](GUIDE.ru.md) · [Spanish](GUIDE.es.md). Contributing:
[`CONTRIBUTING.md`](CONTRIBUTING.md). Development: [`DEVELOPMENT.md`](DEVELOPMENT.md).

Built with the help of Claude Code.

---

If Downbeat saves you time, a star helps other editors find it.
