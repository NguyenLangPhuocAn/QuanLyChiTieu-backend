ALTER TABLE `categories`
  ADD COLUMN `client_request_id` VARCHAR(80) NULL,
  ADD UNIQUE KEY `categories_user_request_key` (`user_id`, `client_request_id`);
