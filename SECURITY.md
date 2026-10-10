# Security

Downbeat is a local panel with no server or account. Analysis and Library
work offline. Background release checks are off by default; enabling the
optional notification asks this project's GitHub release API every three
days. Check now makes one explicit request independently of that preference.
The release button opens the new release page in the browser after
confirmation. Download and installation are manual, outside the panel.
Downbeat does not download packages, launch installers or modify its signed
installation in place.
No audio, library or project content is transmitted. GitHub receives the
network request and its IP address. Feedback/release links open in the
browser after confirmation. The build rejects network code outside the
pinned updater module.

What is worth reporting: anything that lets a crafted audio file, file name,
folder, project or saved settings file make the panel run code, read or write
files outside the explicitly selected audio destination or `Documents/Downbeat`,
or delete a file that is not Downbeat's
own (**Settings > Delete my data** is meant to touch only the files it lists).

Please report it privately through GitHub's "Report a vulnerability" button
on the repository's Security tab (private vulnerability reporting), not in a
public issue. Include the Downbeat version (Settings > Diagnostics > Copy
log shows it), your host app and operating system, and the steps to
reproduce. There is no bug bounty; fixes are made on a best-effort basis.

Generated metronome WAVs are written only to the finished-audio destination
chosen in Settings: Documents/Downbeat/processed, Downbeat/processed next to
a saved project, or a custom folder. Exclusive file creation prevents
overwriting an existing file. Delete my data preserves generated audio.
Imported library metadata is data only; duration and beat phase are validated
before use in host calls or beat-grid loops.

Diagnostics can contain local file paths. Review logs before posting them
publicly. The analysis workers execute bundled local scripts under the
bundled Node runtime; endpoint-security tools may ask about these executions.
A valid ZXP signature does not guarantee that every runtime action will be
accepted by third-party security software.
