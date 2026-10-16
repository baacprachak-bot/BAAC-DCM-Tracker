PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS staff (
 line_user_id TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 role TEXT CHECK(role IN ('credit_head','assistant_manager','manager')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT
);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY,
 first_name TEXT NOT NULL,
 last_name TEXT NOT NULL,
 cif TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
 created_by TEXT NOT NULL REFERENCES staff(line_user_id),
 created_at TEXT NOT NULL,
 approved_by TEXT REFERENCES staff(line_user_id),
 approved_at TEXT,
 CHECK((status='pending' AND approved_by IS NULL AND approved_at IS NULL) OR
       (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_cif ON requests(cif) WHERE status='pending';
CREATE INDEX IF NOT EXISTS request_status_order ON requests(status,created_at,id);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 action TEXT NOT NULL,
 actor TEXT NOT NULL,
 target TEXT NOT NULL,
 happened_at TEXT NOT NULL,
 detail TEXT
);
CREATE TRIGGER IF NOT EXISTS request_created AFTER INSERT ON requests BEGIN
 INSERT INTO audit_log(action,actor,target,happened_at) VALUES('customer_submitted',NEW.created_by,NEW.id,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS request_approved AFTER UPDATE OF status ON requests
WHEN OLD.status='pending' AND NEW.status='approved' BEGIN
 INSERT INTO audit_log(action,actor,target,happened_at) VALUES('customer_approved',NEW.approved_by,NEW.id,NEW.approved_at);
END;
CREATE TRIGGER IF NOT EXISTS staff_access_changed AFTER UPDATE OF role,status ON staff
WHEN (OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status) AND NEW.updated_by IS NOT NULL BEGIN
 INSERT INTO audit_log(action,actor,target,happened_at,detail)
 VALUES('staff_access_changed',NEW.updated_by,NEW.line_user_id,NEW.updated_at,json_object('role',NEW.role,'status',NEW.status));
END;
