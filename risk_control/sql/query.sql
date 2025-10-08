sqlite3 risk_control.db "select * from address_risk_list"

sqlite3 risk_control.db "SELECT * FROM risk_assessments WHERE action = 'withdraw' ORDER BY created_at DESC;"