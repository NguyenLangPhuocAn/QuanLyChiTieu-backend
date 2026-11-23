ALTER TABLE `budgets`
  ADD COLUMN `client_request_id` VARCHAR(80) NULL,
  ADD COLUMN `request_payload_hash` VARCHAR(64) NULL,
  ADD UNIQUE KEY `budgets_user_request_key` (`user_id`, `client_request_id`);
