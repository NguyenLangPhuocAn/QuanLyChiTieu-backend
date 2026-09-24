import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tableExists = async (tableName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    tableName,
  );
  return rows.length > 0;
};

const main = async () => {
  if (!(await tableExists('chatbot_messages'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE chatbot_messages (
        id INT NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        role ENUM('USER', 'ASSISTANT') NOT NULL,
        content TEXT NOT NULL,
        category_spending JSON NULL,
        context_window_days INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX chatbot_messages_user_history_idx (user_id, created_at, id),
        CONSTRAINT chatbot_messages_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('MIGRATION_APPLIED=chatbot_messages');
  } else {
    console.log('MIGRATION_ALREADY_APPLIED=chatbot_messages');
  }

  if (!(await tableExists('chatbot_suggestion_cache'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE chatbot_suggestion_cache (
        user_id INT NOT NULL,
        suggestions JSON NOT NULL,
        generated_for DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id),
        CONSTRAINT chatbot_suggestion_cache_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('MIGRATION_APPLIED=chatbot_suggestion_cache');
  } else {
    console.log('MIGRATION_ALREADY_APPLIED=chatbot_suggestion_cache');
  }

  const verified = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('chatbot_messages', 'chatbot_suggestion_cache')
    ORDER BY TABLE_NAME
  `);
  console.log(`VERIFIED=${JSON.stringify(verified)}`);
};

main()
  .catch((error: unknown) => {
    console.error(
      `MIGRATION_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
