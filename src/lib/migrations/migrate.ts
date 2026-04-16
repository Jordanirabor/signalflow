import { readFileSync } from 'fs';
import { join } from 'path';
import pool from '../db';

const MIGRATION_FILES = [
  '001_initial_schema.sql',
  '002_seed_founder.sql',
  '003_pipeline_schema.sql',
  '004_outreach_personalization.sql',
  '004_cleanup_bad_leads.sql',
  '005_pipeline_state.sql',
  '006_multi_icp_profile.sql',
  '007_founder_oidc.sql',
];

async function migrate() {
  // Create a tracking table so we only run each migration once
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  try {
    for (const file of MIGRATION_FILES) {
      const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        console.log(`Skipping (already applied): ${file}`);
        continue;
      }
      const sql = readFileSync(join(__dirname, file), 'utf-8');
      console.log(`Running migration: ${file}`);
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`Migration completed: ${file}`);
    }
    console.log('All migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
