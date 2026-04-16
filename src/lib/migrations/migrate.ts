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
];

async function migrate() {
  try {
    for (const file of MIGRATION_FILES) {
      const sql = readFileSync(join(__dirname, file), 'utf-8');
      console.log(`Running migration: ${file}`);
      await pool.query(sql);
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
