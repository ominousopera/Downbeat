# Security

Downbeat is a local panel: it has no server and no account, and it makes no
network calls except one optional request: if you switch on the update notice
in Settings (off by default), it asks `api.github.com` for the latest release
of this project once every three days, sends nothing about you, and installs
nothing (`scripts/check-code.js` fails the build if any other code that could
go online is added, or if the notice talks to anything but this project's
release record). The only web addresses it opens are links in Settings, in
your browser, after a confirmation.

What is worth reporting: anything that lets a crafted audio file, file name,
folder, project or saved settings file make the panel run code, read or write
files outside `Documents/Downbeat`, or delete a file that is not Downbeat's
own (**Settings > Delete my data** is meant to touch only the files it lists).

Please report it privately through GitHub's "Report a vulnerability" button
on the repository's Security tab (private vulnerability reporting), not in a
public issue. Include the Downbeat version (Settings > Diagnostics > Copy
log shows it), your host app and operating system, and the steps to
reproduce. There is no bug bounty; fixes are made on a best-effort basis.
