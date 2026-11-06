import { query } from '../config/db.js';

export async function getAllDepartments() {
  const result = await query('SELECT * FROM departments WHERE is_active = true ORDER BY name ASC');
  return result.rows;
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

export default {
  getAllDepartments,
  createDepartment,
};
