import { query } from '../config/db.js';

export async function getAllDepartments() {
  const result = await query('SELECT * FROM departments WHERE is_active = true ORDER BY name ASC');
  return result.rows;
}

export async function getDepartmentById(id) {
  const result = await query('SELECT * FROM departments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createDepartment({ name, code, description }) {
  const result = await query(
    `
    INSERT INTO departments (name, code, description)
    VALUES ($1, $2, $3)
    RETURNING *;
    `,
    [name, code, description]
  );
  return result.rows[0];
}

export async function updateDepartment(id, { name, code, description, isActive }) {
  const fields = [];
  const values = [];

  if (name !== undefined) {
    values.push(name);
    fields.push(`name = $${values.length}`);
  }
  if (code !== undefined) {
    values.push(code);
    fields.push(`code = $${values.length}`);
  }
  if (description !== undefined) {
    values.push(description);
    fields.push(`description = $${values.length}`);
  }
  if (isActive !== undefined) {
    values.push(isActive);
    fields.push(`is_active = $${values.length}`);
  }

  if (fields.length === 0) return await getDepartmentById(id);

  values.push(id);
  const sql = `
    UPDATE departments
    SET ${fields.join(', ')}, updated_at = clock_timestamp()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const result = await query(sql, values);
  return result.rows[0] || null;
}

export async function deleteDepartment(id) {
  const result = await query(
    'UPDATE departments SET is_active = false, updated_at = clock_timestamp() WHERE id = $1 RETURNING *;',
    [id]
  );
  return result.rows[0] || null;
}

export default {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
