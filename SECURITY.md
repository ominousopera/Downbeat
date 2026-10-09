# Security

Downbeat is a local panel: it has no server and no account, and it makes no
network calls except one optional request: if you say yes to the one-time
question about the update notice (or switch it on in Settings; "no" is the
default), it asks `api.github.com` for the latest release of this project
once every three days and sends nothing about you. When a
newer version exists, a button can download its package from that release
(only from GitHub's own hosts, over https), checks it against the SHA-256
checksum published with the release (no checksum, or a mismatch, deletes the
file), saves it in your Downloads folder and hands it to your ZXP installer;
Downbeat installs nothing itself (`scripts/check-code.js` fails the build if
any other code that could go online is added, or if that one file talks to
anything but this project's release record and its downloads). The only web
addresses it opens are links in Settings, in your browser, after a
confirmation.

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
