-- Safe upgrade for transaction hashtags.
-- Run this script on MySQL before deploying hashtag-enabled transaction features.

CREATE TABLE IF NOT EXISTS tags (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  user_id INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name, user_id),
  KEY user_id (user_id)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (transaction_id, tag_id),
  KEY tag_id (tag_id)
);
