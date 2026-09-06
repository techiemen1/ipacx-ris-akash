# Disaster Recovery Plan

## Recovery Targets

| Service | RPO | RTO |
| --- | --- | --- |
| PostgreSQL RIS database | 24 hours | 4 hours |
| Orthanc metadata/storage | 24 hours | 8 hours |
| Uploaded signatures/images | 24 hours | 4 hours |
| Frontend/backend containers | Latest released image | 1 hour |

## Backup Schedule

- Run `scripts/backup_postgres.sh` daily from a trusted host or Kubernetes CronJob.
- Store backups outside the application node.
- Retain daily backups for 14 days by default.
- Test one restore every month using `scripts/restore_postgres.sh`.

## Restore Procedure

1. Stop backend write traffic or put the system in maintenance mode.
2. Restore PostgreSQL from the selected `.dump` file.
3. Restore Orthanc storage from the matching storage snapshot.
4. Restart backend, frontend, Orthanc, Redis, and MWL services.
5. Check `/health/ready`.
6. Validate a sample patient, report, PACS study query, and audit log export.
7. Record incident timeline, data loss window, and corrective actions.

## Validation Checklist

- Database restore completes without errors.
- `SELECT COUNT(*) FROM patients;` returns expected volume.
- Recent reports open and export to PDF.
- PACS study search works from the RIS UI.
- Audit logs are present for the restored period.
- Privacy request records are intact.
