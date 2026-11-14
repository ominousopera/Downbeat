# Security

Downbeat is a local panel with no server or account. Analysis and Library
work offline.

Background release checks are off by default. When the optional
notification is turned on, the panel asks this project's GitHub release API
every three days. Check now makes one explicit request, whatever that
setting is. The release button opens the new release page in the browser
after confirmation; download and installation are manual, outside the
panel. Downbeat does not download packages, launch installers or modify its
signed installation in place.

No audio, library or project content is transmitted. GitHub receives the
network request and its IP address. Feedback and release links open in the
browser after confirmation. The build rejects network code outside the
pinned updater module.

Report anything that lets a crafted audio file, file name, folder, project
or saved settings file make the panel run code, read or write files outside
the explicitly selected audio destination, `Documents/Downbeat` or the
`Downbeat` folder in the system's temp folder (where the analysis helpers'
temporary audio copies go), or delete a file that is not Downbeat's own
(**Settings > Delete my data** is meant to touch only the files it lists).

Please send the report privately through GitHub's "Report a vulnerability"
button on the repository's Security tab (private vulnerability reporting),
not in a public issue. Include the Downbeat version (Settings >
Diagnostics > Copy log shows it), your host app and operating system, and
the steps to reproduce. There is no bug bounty; fixes are made on a
best-effort basis.

Generated metronome WAVs are written only to the finished-audio destination
chosen in Settings: Documents/Downbeat/processed, Downbeat/processed next to
a saved project, or a custom folder. They are created with exclusive file
creation, which prevents overwriting an existing file, and Delete my data
keeps generated audio. Library data read from disk is treated as data only:
durations and beat positions are checked before the host uses them.

Diagnostics can contain local file paths, so review logs before posting
them publicly. The analysis workers run bundled local scripts under the
bundled Node runtime, and endpoint-security tools may ask about them. A
valid ZXP signature does not guarantee that third-party security software
will accept every runtime action.

Confirmed keys and tempos live only in Documents/Downbeat and in library
backups you make yourself. Confirming them does not edit original media or
send analysis data online. Analysis results are tied to a file's size and
modification date, so a replaced file is analyzed again.
