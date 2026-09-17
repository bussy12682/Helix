/**
 * HELIX AI Engineering Operating System — Database Engineer AI
 * Designs PostgreSQL/relational schemas, migrations, constraints, and indexes.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class DatabaseEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.DATABASE_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED DATABASE ENGINEER GUIDELINES:
- Author production-grade SQL DDL statements (CREATE TABLE, ALTER TABLE, CREATE INDEX).
- Specify PRIMARY KEY, NOT NULL, UNIQUE, and FOREIGN KEY with ON DELETE CASCADE / RESTRICT.
- Provide optimal composite and single-column indexes for anticipated query filters and foreign keys.
- Include seed data inserts for testing.
- Produce artifact: "database/schema.sql".`;
  }
}
