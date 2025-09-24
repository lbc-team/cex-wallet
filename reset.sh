pkill -f "wallet.*ts-node" && pkill -f "scan.*ts-node" && pkill -f "signer.*ts-node"
rm -rf wallet/wallet.db
rm -rf wallet/wallet.db-shm
rm -rf wallet/wallet.db-wal
rm -rf signer/signer.db
