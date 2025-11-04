sqlite3 wallet.db "SELECT from_addr, to_addr, token_addr, amount, type, status FROM transactions ORDER BY id LIMIT 100;"

sqlite3 wallet.db "SELECT * FROM solana_slots;"

sqlite3 wallet.db "SELECT * FROM solana_transactions;"

sqlite3 wallet.db "SELECT * FROM users;"

sqlite3 wallet.db "SELECT * FROM tokens;"

sqlite3 wallet.db "SELECT * FROM wallets;"

sqlite3 wallet.db "SELECT * FROM blocks;"

sqlite3 wallet.db "SELECT * FROM credits;"

sqlite3 wallet.db "SELECT user_id, address, credit_type, business_type, reference_id, status  FROM credits;"

sqlite3 wallet.db "SELECT * FROM withdraws;"

sqlite3 wallet.db "SELECT * FROM used_operation_ids;"

sqlite3 wallet.db "SELECT user_id, address FROM wallets;"

sqlite3 wallet.db "SELECT * FROM solana_token_accounts;"