# Security

Downbeat is a local panel: it has no server, no account, no update check and
makes no network calls (`scripts/check-code.js` fails the build if code that
could is added). The only web address it ever opens is a link in Settings,
in your browser, after a confirmation.

What is worth reporting: anything that lets a crafted audio file, file name,
folder, project or saved settings file make the panel run code, read or write
files outside `Documents/Downbeat`, or delete a file that is not Downbeat's
own (**Settings > Delete my data** is meant to touch only the files it lists).

Please report it privately through GitHub's "Report a vulnerability" button
on the repository's Security tab (private vulnerability reporting), not in a
public issue. Include the Downbeat version (Settings > Diagnostics > Copy
log shows it), your host app and operating system, and the steps to
reproduce. There is no bug bounty; fixes are made on a best-effort basis.
