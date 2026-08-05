import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';
const r = await pool.query(`
SELECT
  (SELECT count(*)::int FROM users WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b') AS users,
  (SELECT count(*)::int FROM users WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b' AND role='employee' AND coalesce(status,'active')='active') AS active_emp,
  (SELECT count(*)::int FROM departments WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b') AS departments,
  (SELECT count(*)::int FROM time_records WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b') AS time_records
`);
const health = await fetch('http://127.0.0.1:3000/api/health').then((x) => x.json());
const fe = await fetch('http://127.0.0.1:3010/').then((x) => x.status);
console.log(JSON.stringify({ persistence: r.rows[0], health, frontend: fe }, null, 2));
await pool.end();
