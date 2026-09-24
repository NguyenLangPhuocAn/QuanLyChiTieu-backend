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

const columnExists = async (tableName: string, columnName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    tableName,
    columnName,
  );
  return rows.length > 0;
};

const indexExists = async (tableName: string, indexName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ INDEX_NAME: string }>>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    tableName,
    indexName,
  );
  return rows.length > 0;
};

const constraintExists = async (constraintName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ CONSTRAINT_NAME: string }>>(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_NAME = ?`,
    constraintName,
  );
  return rows.length > 0;
};

const main = async () => {
  if (!(await tableExists('chatbot_conversations'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE chatbot_conversations (
        id INT NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        title VARCHAR(120) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX chatbot_conversations_user_updated_idx (user_id, updated_at, id),
        CONSTRAINT chatbot_conversations_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('MIGRATION_APPLIED=chatbot_conversations');
  } else {
    console.log('MIGRATION_ALREADY_APPLIED=chatbot_conversations');
  }

  if (!(await columnExists('chatbot_messages', 'conversation_id'))) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE chatbot_messages ADD COLUMN conversation_id INT NULL AFTER user_id',
    );
    console.log('MIGRATION_APPLIED=chatbot_messages.conversation_id');
  }

  if (
    !(await indexExists(
      'chatbot_messages',
      'chatbot_messages_conversation_history_idx',
    ))
  ) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE chatbot_messages
      ADD INDEX chatbot_messages_conversation_history_idx
        (conversation_id, created_at, id)
    `);
  }

  if (
    !(await constraintExists('chatbot_messages_conversation_id_fkey'))
  ) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE chatbot_messages
      ADD CONSTRAINT chatbot_messages_conversation_id_fkey
        FOREIGN KEY (conversation_id)
        REFERENCES chatbot_conversations(id)
        ON DELETE CASCADE
    `);
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO chatbot_conversations (user_id, title, created_at, updated_at)
    SELECT
      message.user_id,
      CONCAT(
        'Lịch sử ngày ',
        DATE_FORMAT(DATE(MIN(message.created_at)), '%d/%m/%Y')
      ),
      MIN(message.created_at),
      MAX(message.created_at)
    FROM chatbot_messages AS message
    LEFT JOIN chatbot_conversations AS existing
      ON existing.user_id = message.user_id
     AND existing.title = CONCAT(
       'Lịch sử ngày ',
       DATE_FORMAT(DATE(message.created_at), '%d/%m/%Y')
     )
    WHERE message.conversation_id IS NULL
      AND existing.id IS NULL
    GROUP BY message.user_id, DATE(message.created_at)
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE chatbot_messages AS message
    INNER JOIN chatbot_conversations AS conversation
      ON conversation.user_id = message.user_id
     AND conversation.title = CONCAT(
       'Lịch sử ngày ',
       DATE_FORMAT(DATE(message.created_at), '%d/%m/%Y')
     )
    SET message.conversation_id = conversation.id
    WHERE message.conversation_id IS NULL
  `);

  const [conversationCount, unassignedCount] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM chatbot_conversations',
    ),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM chatbot_messages WHERE conversation_id IS NULL',
    ),
  ]);
  console.log(
    `VERIFIED=${JSON.stringify({
      conversations: Number(conversationCount[0]?.count ?? 0),
      unassigned_messages: Number(unassignedCount[0]?.count ?? 0),
    })}`,
  );
};

main()
  .catch((error: unknown) => {
    console.error(
      `MIGRATION_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
