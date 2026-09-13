# LVM Panel - Data Storage Directory

This directory stores the persistent database and runtime records for LVM Panel.

## Files:
- `lvm_db.json`: The live active database file (users, nodes, VPS instances, activities, settings). Created automatically when `install.sh` or `npm run init-db` runs.
- `lvm_db.default.json`: Clean template schema for new installations.
- `*.backup`: Automatic backup snapshots generated before migrations or by `scripts/backup.sh`.

> **Note:** Never commit production `lvm_db.json` files containing live user passwords to public repositories. It is safely excluded in `.gitignore`.
