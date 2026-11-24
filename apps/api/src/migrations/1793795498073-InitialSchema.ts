import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1793795498073 implements MigrationInterface {
  name = 'InitialSchema1793795498073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying(32) NOT NULL, "passwordHash" character varying NOT NULL, "refreshTokenHash" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "github_installations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "githubInstallationId" bigint NOT NULL, "accountLogin" character varying NOT NULL, "userId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6c4f96ba219a87cf299f5e01397" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6f3e72837110805b378685f8be" ON "github_installations"  ("githubInstallationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "repositories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "githubRepoId" bigint NOT NULL, "fullName" character varying NOT NULL, "defaultBranch" character varying NOT NULL DEFAULT 'main', "private" boolean NOT NULL DEFAULT true, "installationId" uuid NOT NULL, "agentTriage" boolean NOT NULL DEFAULT true, "agentAutoFix" boolean NOT NULL DEFAULT true, "agentPrReview" boolean NOT NULL DEFAULT true, "maxOpenAgentPrs" integer NOT NULL DEFAULT '3', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ef0c358c04b4f4d29b8ca68ddff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a477894a09b73af227d8395187" ON "repositories"  ("githubRepoId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repositoryId" uuid NOT NULL, "userId" uuid NOT NULL, "title" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2680ac7af80219a718cf98a1d21" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed4d15ed73f09e6b3f48c9ebee" ON "agent_conversations"  ("repositoryId", "userId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_messages_role_enum" AS ENUM('user', 'assistant')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_messages_status_enum" AS ENUM('pending', 'done', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversationId" uuid NOT NULL, "role" "public"."agent_messages_role_enum" NOT NULL, "content" text NOT NULL DEFAULT '', "status" "public"."agent_messages_status_enum" NOT NULL DEFAULT 'done', "runId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8c7cdeda30e81dba421925df4fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2904a764dd3ebcb7a8dccb7914" ON "agent_messages"  ("conversationId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_runs_kind_enum" AS ENUM('triage', 'fix', 'review', 'chat')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_runs_status_enum" AS ENUM('running', 'done', 'failed', 'refused', 'budget_exceeded', 'max_steps', 'skipped')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repositoryId" uuid NOT NULL, "kind" "public"."agent_runs_kind_enum" NOT NULL, "status" "public"."agent_runs_status_enum" NOT NULL DEFAULT 'running', "title" character varying NOT NULL, "summary" text NOT NULL DEFAULT '', "target" jsonb NOT NULL DEFAULT '{}', "model" character varying NOT NULL DEFAULT '', "inputTokens" integer NOT NULL DEFAULT '0', "outputTokens" integer NOT NULL DEFAULT '0', "steps" integer NOT NULL DEFAULT '0', "error" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finishedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_442f7e0ec4ae860cf17edc57825" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c864e0deef4a4c8d457d49143" ON "agent_runs"  ("repositoryId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_steps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "runId" uuid NOT NULL, "index" integer NOT NULL, "text" text NOT NULL DEFAULT '', "toolCalls" jsonb NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8b98d514603983a4aab90a73f79" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01c2ac99f6ba02a6201acbf1d5" ON "agent_steps"  ("runId", "index") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_fixes_module_enum" AS ENUM('supply_chain', 'code_audit', 'secrets', 'infra')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_fixes_status_enum" AS ENUM('open', 'merged', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_fixes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repositoryId" uuid NOT NULL, "module" "public"."agent_fixes_module_enum" NOT NULL, "findingIds" uuid array NOT NULL, "title" character varying NOT NULL, "branch" character varying NOT NULL, "prNumber" integer NOT NULL, "prUrl" character varying NOT NULL, "status" "public"."agent_fixes_status_enum" NOT NULL DEFAULT 'open', "runId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_edc24315466fb4632691105173b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00f8c54885556cd94153b2279e" ON "agent_fixes"  ("repositoryId", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."findings_module_enum" AS ENUM('supply_chain', 'code_audit', 'secrets', 'infra')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."findings_severity_enum" AS ENUM('critical', 'high', 'medium', 'low', 'info')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."findings_status_enum" AS ENUM('open', 'ignored', 'fixed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "findings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repositoryId" uuid NOT NULL, "module" "public"."findings_module_enum" NOT NULL, "tool" character varying NOT NULL, "ruleId" character varying NOT NULL, "severity" "public"."findings_severity_enum" NOT NULL, "title" character varying NOT NULL, "description" text NOT NULL DEFAULT '', "filePath" character varying, "line" integer, "fingerprint" character varying(64) NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "action" text NOT NULL DEFAULT '', "status" "public"."findings_status_enum" NOT NULL DEFAULT 'open', "priorityScore" real NOT NULL DEFAULT '0', "agentVerdict" jsonb, "statusReason" text, "firstSeenScanId" uuid NOT NULL, "lastSeenScanId" uuid NOT NULL, "fixedInScanId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ae9807d6293c23c13ff8804d09c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d7362ff2f0cd0fe37b2bdd79c" ON "findings"  ("lastSeenScanId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_684f1d275fd8a16402035aaa9b" ON "findings"  ("repositoryId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scans_modules_enum" AS ENUM('supply_chain', 'code_audit', 'secrets', 'infra')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scans_status_enum" AS ENUM('queued', 'running', 'done', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scans_trigger_enum" AS ENUM('manual', 'push')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scans_triagestatus_enum" AS ENUM('pending', 'running', 'done', 'skipped', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repositoryId" uuid NOT NULL, "branch" character varying NOT NULL, "commitSha" character varying(40), "modules" "public"."scans_modules_enum" array NOT NULL, "status" "public"."scans_status_enum" NOT NULL DEFAULT 'queued', "trigger" "public"."scans_trigger_enum" NOT NULL, "error" text, "triageStatus" "public"."scans_triagestatus_enum", "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_41156c08314b9e541c1cb18c588" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_caf97d1a9b21d63e700dd368ff" ON "scans"  ("repositoryId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scan_module_runs_module_enum" AS ENUM('supply_chain', 'code_audit', 'secrets', 'infra')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scan_module_runs_status_enum" AS ENUM('done', 'partial', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scan_module_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scanId" uuid NOT NULL, "module" "public"."scan_module_runs_module_enum" NOT NULL, "status" "public"."scan_module_runs_status_enum" NOT NULL, "tools" jsonb NOT NULL DEFAULT '[]', "durationMs" integer NOT NULL, CONSTRAINT "UQ_ee92d5aea27b83f84b243d2975d" UNIQUE ("scanId", "module"), CONSTRAINT "PK_5d6c005e2979cf58e67cf2f26a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_installations" ADD CONSTRAINT "FK_2192f8bbdc85dc3e27169683873" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "repositories" ADD CONSTRAINT "FK_64d4e6249163dd53c8606952b01" FOREIGN KEY ("installationId") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD CONSTRAINT "FK_2dcccfcee4a1e60e53059bc7ccf" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_9f68a41320a98ce0bef83630d23" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_steps" ADD CONSTRAINT "FK_34b1bf6db6ff6afc6283c9f9c36" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_fixes" ADD CONSTRAINT "FK_e1c3f610adda129a66c335927e3" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "findings" ADD CONSTRAINT "FK_e8ece9d9f85cb40678ad3812423" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "scans" ADD CONSTRAINT "FK_027bd3801bdae02b0e3f7b2fd8e" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "scan_module_runs" ADD CONSTRAINT "FK_b0fe13894f0592419d5cd31fc77" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scan_module_runs" DROP CONSTRAINT "FK_b0fe13894f0592419d5cd31fc77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scans" DROP CONSTRAINT "FK_027bd3801bdae02b0e3f7b2fd8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "findings" DROP CONSTRAINT "FK_e8ece9d9f85cb40678ad3812423"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_fixes" DROP CONSTRAINT "FK_e1c3f610adda129a66c335927e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_steps" DROP CONSTRAINT "FK_34b1bf6db6ff6afc6283c9f9c36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_9f68a41320a98ce0bef83630d23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP CONSTRAINT "FK_2dcccfcee4a1e60e53059bc7ccf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP CONSTRAINT "FK_64d4e6249163dd53c8606952b01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_installations" DROP CONSTRAINT "FK_2192f8bbdc85dc3e27169683873"`,
    );
    await queryRunner.query(`DROP TABLE "scan_module_runs"`);
    await queryRunner.query(
      `DROP TYPE "public"."scan_module_runs_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."scan_module_runs_module_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_caf97d1a9b21d63e700dd368ff"`,
    );
    await queryRunner.query(`DROP TABLE "scans"`);
    await queryRunner.query(`DROP TYPE "public"."scans_triagestatus_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scans_trigger_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scans_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scans_modules_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_684f1d275fd8a16402035aaa9b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d7362ff2f0cd0fe37b2bdd79c"`,
    );
    await queryRunner.query(`DROP TABLE "findings"`);
    await queryRunner.query(`DROP TYPE "public"."findings_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."findings_severity_enum"`);
    await queryRunner.query(`DROP TYPE "public"."findings_module_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00f8c54885556cd94153b2279e"`,
    );
    await queryRunner.query(`DROP TABLE "agent_fixes"`);
    await queryRunner.query(`DROP TYPE "public"."agent_fixes_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."agent_fixes_module_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01c2ac99f6ba02a6201acbf1d5"`,
    );
    await queryRunner.query(`DROP TABLE "agent_steps"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c864e0deef4a4c8d457d49143"`,
    );
    await queryRunner.query(`DROP TABLE "agent_runs"`);
    await queryRunner.query(`DROP TYPE "public"."agent_runs_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."agent_runs_kind_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2904a764dd3ebcb7a8dccb7914"`,
    );
    await queryRunner.query(`DROP TABLE "agent_messages"`);
    await queryRunner.query(`DROP TYPE "public"."agent_messages_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."agent_messages_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed4d15ed73f09e6b3f48c9ebee"`,
    );
    await queryRunner.query(`DROP TABLE "agent_conversations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a477894a09b73af227d8395187"`,
    );
    await queryRunner.query(`DROP TABLE "repositories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f3e72837110805b378685f8be"`,
    );
    await queryRunner.query(`DROP TABLE "github_installations"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
