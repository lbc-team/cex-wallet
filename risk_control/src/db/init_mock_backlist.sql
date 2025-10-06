-- Mock Blacklist Addresses for Testing

INSERT OR IGNORE INTO address_risk_list (
  address,
  chain_type,
  risk_type,
  risk_level,
  reason,
  source,
  enabled
) VALUES (
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  'evm',
  'blacklist',
  'high',
  'Test blacklist address for development',
  'manual',
  1
);
