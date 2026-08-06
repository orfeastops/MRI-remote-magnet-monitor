# Security and deployment notice

This repository contains an engineering prototype, not a production-ready or certified medical-device system.

## Credentials

- No production credentials, Wi-Fi passwords, API tokens, tunnel identifiers, or private keys should be committed.
- Copy environment templates locally and replace every placeholder with independently generated values.
- Use per-environment secrets and rotate them if they are ever exposed in source control, logs, screenshots, or deployment archives.
- Do not put long-lived credentials in frontend code or firmware intended for public distribution.

## Deployment boundaries

- Place the backend behind TLS and a maintained reverse proxy.
- Restrict administrative and device endpoints to the minimum required network scope.
- Use per-device credentials, rate limiting, audit logs, backups, monitoring, and a tested recovery procedure before any operational deployment.
- Validate electrical isolation and interface protection with qualified personnel before connecting custom electronics to equipment.

## Medical and safety disclaimer

The prototype observes equipment telemetry and alarm-contact states only. It must not process patient data or replace OEM monitoring, safety systems, service procedures, or qualified technical personnel.

Please do not include sensitive details in a public issue. Contact the repository owner through the GitHub profile for private security coordination.
