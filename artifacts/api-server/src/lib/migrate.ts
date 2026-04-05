import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Ensures all required tables exist. Runs on every startup.
 * Uses IF NOT EXISTS so it's safe to run repeatedly.
 * This keeps data intact across deploys — only missing tables are created.
 */
export async function ensureTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS study_materials (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        file_type TEXT NOT NULL DEFAULT 'tekst',
        chapter TEXT,
        exam_type TEXT,
        tags TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS study_goals (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        target_date TIMESTAMP NOT NULL,
        hours_per_week REAL NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'actief',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        type TEXT NOT NULL DEFAULT 'studie',
        subject TEXT,
        color TEXT,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        user_name TEXT NOT NULL DEFAULT '',
        difficulty_level TEXT NOT NULL DEFAULT 'gemiddeld',
        preferred_language TEXT NOT NULL DEFAULT 'nl',
        voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        coach_style TEXT NOT NULL DEFAULT 'gebalanceerd',
        study_reminders BOOLEAN NOT NULL DEFAULT TRUE,
        weekly_goal_hours REAL NOT NULL DEFAULT 10,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notification_settings (
        id SERIAL PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        evening_reminder BOOLEAN NOT NULL DEFAULT TRUE,
        evening_reminder_time TEXT NOT NULL DEFAULT '21:00',
        push_subscription TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS weak_points (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        topic TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'gemiddeld',
        suggested_action TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS study_sessions (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("Database tables verified");
  } catch (err) {
    logger.error({ err }, "Failed to ensure database tables");
    throw err;
  } finally {
    client.release();
  }
}
