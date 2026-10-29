import { Pool } from 'pg';

export default async function globalSetup() {
	const pool = new Pool({ connectionString: 'postgresql://lfys:lfys_dev_only@localhost:5432/lfys' });

	try {
		await pool.query('CREATE DATABASE lfys_e2e');
	} catch (error) {
		if (error.code !== '42P04') throw error;
	} finally {
		await pool.end();
	}
}
