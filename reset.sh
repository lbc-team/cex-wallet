#!/bin/bash

echo "Resetting db_gateway, wallet, scan, and signer databases..."


pkill -f "wallet.*ts-node" && pkill -f "scan.*ts-node" && pkill -f "signer.*ts-node"  && pkill -f "db_gateway.*ts-node" && pkill -f "risk_control.*ts-node"


rm -rf db_gateway/wallet.db
rm -rf db_gateway/wallet.db-shm
rm -rf db_gateway/wallet.db-wal
rm -rf signer/signer.db

rm -rf scan/logs
rm -rf db_gateway/logs
rm -rf risk_control/logs


