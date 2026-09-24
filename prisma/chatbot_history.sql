-- Persistent, per-account chatbot history and daily personalized prompts.
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
);

CREATE TABLE chatbot_suggestion_cache (
  user_id INT NOT NULL,
  suggestions JSON NOT NULL,
  generated_for DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT chatbot_suggestion_cache_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
