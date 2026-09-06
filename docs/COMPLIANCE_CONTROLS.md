# Compliance Controls

## HIPAA-Oriented Controls

| Control | Implementation |
| --- | --- |
| Access control | JWT authentication and role-protected routes |
| Audit controls | `audit_logs`, archive scheduler, privacy export/anonymization events |
| Integrity | Database constraints, report status flow, addendum support |
| Transmission security | Deploy behind TLS termination; keep HTTP internal-only |
| Minimum necessary access | Admin-only settings and audit views |

## GDPR-Oriented Controls

| Right | Implementation |
| --- | --- |
| Access | `GET /api/privacy/patient/:identifier/export` |
| Erasure | `POST /api/privacy/patient/:identifier/anonymize` |
| Request tracking | `POST /api/privacy/requests`, `GET /api/privacy/requests` |
| Data minimization | Anonymization removes direct contact and identity fields |

## ISO 27001 Preparation

- Maintain the asset register for RIS, PACS, MWL, database, Redis, and backups.
- Review access roles monthly.
- Test backup restore monthly.
- Review audit logs weekly.
- Track privacy requests to closure.
- Run dependency audit before each release.
