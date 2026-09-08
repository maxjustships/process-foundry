# Security policy

## Supported version

Security fixes are made on the current repository version. Before reporting a vulnerability, reproduce it against the latest available revision when doing so is safe and does not affect other people or data.

## Reporting a vulnerability

If GitHub private vulnerability reporting is enabled for this repository, use **Security → Report a vulnerability**. Include the affected component, impact, reproduction conditions, and a minimal proof of concept. Remove credentials, source material, personal data, and unrelated logs.

If private vulnerability reporting is not available, open a minimal, non-sensitive issue asking the maintainers to establish a private reporting channel. Include only that a potential security issue exists and the broad affected area. Do not publish exploit steps, payloads, screenshots, logs, secrets, private data, or other details that would help someone reproduce or abuse the issue.

Please allow maintainers time to investigate and coordinate a fix before any disclosure. Do not test against deployments, accounts, or data you do not own or have explicit permission to assess.

## Operational security

Process Foundry uses a shared mnemonic login and is intended for private deployment with anonymized examples. It does not provide accounts, teams, or RBAC. Operators should follow the resource isolation, secret handling, privacy, upgrade, and rollback guidance in [the self-hosting guide](docs/SELF_HOSTING.md).
