import { MigrationInterface, QueryRunner } from 'typeorm';

export class Spaces1795513206126 implements MigrationInterface {
  name = 'Spaces1795513206126';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed4d15ed73f09e6b3f48c9ebee"`,
    );
    await queryRunner.query(
      `CREATE TABLE "spaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying(60) NOT NULL, "repositoriesChangedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dbe542974aca57afcb60709d4c8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a0af71a31b73ad493922ec926" ON "spaces"  ("userId", "name") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."space_graphs_status_enum" AS ENUM('running', 'done', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "space_graphs" ("spaceId" uuid NOT NULL, "status" "public"."space_graphs_status_enum" NOT NULL, "nodes" jsonb NOT NULL DEFAULT '[]', "edges" jsonb NOT NULL DEFAULT '[]', "runId" uuid, "error" text, "startedAt" TIMESTAMP WITH TIME ZONE, "generatedAt" TIMESTAMP WITH TIME ZONE, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e6b4c3b461009146265c4fa8429" PRIMARY KEY ("spaceId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "space_repositories" ("spaceId" uuid NOT NULL, "repositoryId" uuid NOT NULL, "addedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6e0b9424f463079e57a066f08a6" PRIMARY KEY ("spaceId", "repositoryId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_523de8898353ed563562bd98f2" ON "space_repositories"  ("repositoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD "spaceId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "spaceId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ALTER COLUMN "repositoryId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_9f68a41320a98ce0bef83630d23"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c864e0deef4a4c8d457d49143"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "repositoryId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."agent_runs_kind_enum" ADD VALUE 'map'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be20d79b2c53ea25ad4c1fa1a6" ON "agent_conversations"  ("spaceId", "userId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0322e338aa1a1d800264dfa39b" ON "agent_runs"  ("spaceId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c864e0deef4a4c8d457d49143" ON "agent_runs"  ("repositoryId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "spaces" ADD CONSTRAINT "FK_533cbce0a78fc63c5f012d1922b" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "FK_2fc72a0e5a03d9837848dfe149b" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_9f68a41320a98ce0bef83630d23" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_aa37bee990c5d1d96a3fe08127b" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_graphs" ADD CONSTRAINT "FK_e6b4c3b461009146265c4fa8429" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_repositories" ADD CONSTRAINT "FK_3df550cfa924067efb66099f942" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_repositories" ADD CONSTRAINT "FK_523de8898353ed563562bd98f29" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Перенос данных: разговоры с агентом раньше принадлежали репозиторию, теперь — пространству.
    // Каждому пользователю с разговорами создаём пространство со всеми его репозиториями;
    // репозиторий разговора остаётся его фокусом.
    await queryRunner.query(
      `INSERT INTO "spaces" ("userId", "name") SELECT DISTINCT c."userId", 'All repositories' FROM "agent_conversations" c JOIN "users" u ON u."id" = c."userId"`,
    );
    await queryRunner.query(
      `INSERT INTO "space_repositories" ("spaceId", "repositoryId") SELECT s."id", r."id" FROM "spaces" s JOIN "github_installations" i ON i."userId" = s."userId" JOIN "repositories" r ON r."installationId" = i."id"`,
    );
    await queryRunner.query(
      `UPDATE "agent_conversations" c SET "spaceId" = s."id" FROM "spaces" s WHERE s."userId" = c."userId"`,
    );
    await queryRunner.query(
      `UPDATE "agent_runs" r SET "spaceId" = c."spaceId" FROM "agent_conversations" c WHERE r."kind" = 'chat' AND r."target"->>'conversationId' = c."id"::text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Запуски и разговоры без репозитория существуют только в пространствах — в старой схеме им нет места.
    await queryRunner.query(
      `DELETE FROM "agent_runs" WHERE "repositoryId" IS NULL OR "kind" = 'map'`,
    );
    await queryRunner.query(
      `DELETE FROM "agent_conversations" WHERE "repositoryId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_repositories" DROP CONSTRAINT "FK_523de8898353ed563562bd98f29"`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_repositories" DROP CONSTRAINT "FK_3df550cfa924067efb66099f942"`,
    );
    await queryRunner.query(
      `ALTER TABLE "space_graphs" DROP CONSTRAINT "FK_e6b4c3b461009146265c4fa8429"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_aa37bee990c5d1d96a3fe08127b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_9f68a41320a98ce0bef83630d23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "FK_2fc72a0e5a03d9837848dfe149b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "spaces" DROP CONSTRAINT "FK_533cbce0a78fc63c5f012d1922b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c864e0deef4a4c8d457d49143"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0322e338aa1a1d800264dfa39b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be20d79b2c53ea25ad4c1fa1a6"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."agent_runs_kind_enum_old" AS ENUM('triage', 'fix', 'review', 'chat')`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "kind" TYPE "public"."agent_runs_kind_enum_old" USING "kind"::"text"::"public"."agent_runs_kind_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."agent_runs_kind_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."agent_runs_kind_enum_old" RENAME TO "agent_runs_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "repositoryId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c864e0deef4a4c8d457d49143" ON "agent_runs" USING btree ("repositoryId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_9f68a41320a98ce0bef83630d23" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ALTER COLUMN "repositoryId" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "spaceId"`);
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP COLUMN "spaceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_523de8898353ed563562bd98f2"`,
    );
    await queryRunner.query(`DROP TABLE "space_repositories"`);
    await queryRunner.query(`DROP TABLE "space_graphs"`);
    await queryRunner.query(`DROP TYPE "public"."space_graphs_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a0af71a31b73ad493922ec926"`,
    );
    await queryRunner.query(`DROP TABLE "spaces"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_ed4d15ed73f09e6b3f48c9ebee" ON "agent_conversations" USING btree ("repositoryId", "userId", "updatedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "FK_86a5de7afd35dee17ac7e79bc16" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
