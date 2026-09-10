# Security policy

## Supported versions

Security fixes are provided for the latest stable release. A release candidate is
supported only while it is the newest published build.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when it is
available. If that option is not shown, contact the maintainer through the email in
`package.json`. Do not open a public issue for an undisclosed vulnerability.

Include the affected version and platform, reproduction steps, impact, and any
suggested mitigation. Remove API keys, tokens, credentials, certificate material,
conversation contents, and private filesystem paths from all attachments.

## LAN access warning

Listening on `0.0.0.0` exposes an agent capable of running local commands to other
devices on the network. Use LAN access only on a trusted network. DSH-Desktop does
not provide authentication or make direct public-internet exposure safe; prefer an
SSH tunnel or another authenticated access layer for remote use.
