-- ChatGPT-style conversation history. Existing messages are preserved and
-- grouped into one imported conversation per account and calendar day.
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
);

ALTER TABLE chatbot_messages
  ADD COLUMN conversation_id INT NULL AFTER user_id,
  ADD INDEX chatbot_messages_conversation_history_idx (conversation_id, created_at, id),
  ADD CONSTRAINT chatbot_messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES chatbot_conversations(id) ON DELETE CASCADE;

INSERT INTO chatbot_conversations (user_id, title, created_at, updated_at)
SELECT
  user_id,
  CONCAT(
    'Lịch sử ngày ',
    DATE_FORMAT(DATE(MIN(created_at)), '%d/%m/%Y')
  ),
  MIN(created_at),
  MAX(created_at)
FROM chatbot_messages
WHERE conversation_id IS NULL
GROUP BY user_id, DATE(created_at);

UPDATE chatbot_messages AS message
INNER JOIN chatbot_conversations AS conversation
  ON conversation.user_id = message.user_id
 AND conversation.title = CONCAT(
   'Lịch sử ngày ',
   DATE_FORMAT(DATE(message.created_at), '%d/%m/%Y')
 )
SET message.conversation_id = conversation.id
WHERE message.conversation_id IS NULL;
