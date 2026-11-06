/**
 * Aarogya HMS - Role-Based Access Control (RBAC) Policy Matrix
 * 
 * Matrix Definition:
 * | Resource           | Action       | Admin | Clinician          | Front Desk | Conditions                                     |
 * |--------------------|--------------|-------|--------------------|------------|------------------------------------------------|
 * | directory          | read         | YES   | YES                | YES        | Public hospital directory                      |
 * | directory          | write        | YES   | NO                 | NO         | Staff, departments, schedules management       |
 * | patients           | read         | YES   | OWNED_ONLY         | YES        | Clinician: only patients with appointment      |
 * | patients           | write        | NO    | NO                 | YES        | Demographics CRUD managed by front desk        |
 * | appointments       | read         | YES   | OWN_ONLY           | YES        | Clinician: only appointments assigned to doctor|
 * | appointments       | write        | NO    | OWN_ONLY (cancel)  | YES        | Front desk: full lifecycle; Clinician: own     |
 * | encounters         | read_meta    | YES   | OWNED_ONLY         | NO         | Admin: metadata only (no notes); Clinician: own|
 * | clinical_notes     | read         | NO    | OWNED_ONLY         | NO         | Strictly clinician-patient relationship only   |
 * | clinical_notes     | write        | NO    | OWNED_ONLY         | NO         | Treating clinician only                        |
 * | prescriptions      | read/write   | NO    | OWNED_ONLY         | NO         | Treating clinician only                        |
 * | diagnostic_reports | read/write   | NO    | OWNED_ONLY         | NO         | Metadata only, treating clinician only         |
 * | invoices           | read/write   | YES   | NO                 | YES        | Billing managed by front desk & admin          |
 * | payments           | read/write   | YES   | NO                 | YES        | Payments managed by front desk & admin         |
 * | audit_logs         | read         | YES   | NO                 | NO         | System admin security auditing only            |
 */

export const ROLES = {
  ADMIN: 'admin',
  CLINICIAN: 'clinician',
  FRONT_DESK: 'front_desk',
};

export const RBAC_POLICY = {
  directory: {
    read: ['admin', 'clinician', 'front_desk'],
    write: ['admin'],
  },
  patients: {
    read: ['admin', 'clinician', 'front_desk'],
    create: ['front_desk'],
    update: ['front_desk'],
    delete: ['front_desk'],
  },
  appointments: {
    read: ['admin', 'clinician', 'front_desk'],
    book: ['front_desk'],
    reschedule: ['front_desk'],
    cancel: ['front_desk', 'clinician'],
    check_in: ['front_desk'],
  },
  encounters: {
    read_metadata: ['admin', 'clinician'],
    create: ['clinician'],
    update: ['clinician'],
  },
  clinical_notes: {
    read: ['clinician'],
    write: ['clinician'],
  },
  prescriptions: {
    read: ['clinician'],
    write: ['clinician'],
  },
  diagnostic_reports: {
    read: ['clinician'],
    write: ['clinician'],
  },
  billing: {
    read: ['admin', 'front_desk'],
    write: ['admin', 'front_desk'],
  },
  audit_logs: {
    read: ['admin'],
    write: [], // System trigger append-only
  },
};

/**
 * Checks if a given role is statically allowed for a resource action.
 * (Dynamic ownership checks like clinician→patient are evaluated in services/helpers).
 */
export function hasRolePermission(role, resource, action) {
  const resourcePolicy = RBAC_POLICY[resource];
  if (!resourcePolicy) return false;
  const allowedRoles = resourcePolicy[action];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

export default {
  ROLES,
  RBAC_POLICY,
  hasRolePermission,
};
