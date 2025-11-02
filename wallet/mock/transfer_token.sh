# anvil --block-time 1

# userID : 1 hotwallet 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44
cast send 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 --value 20000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545

cast send 0x3C4383598A2094dc52aCba411DE7bA0b32Adb4E9 --value 1000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x972edE2A6BD7b6Ea46E3981006D499dAf726bf9e --value 1000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x33633C5056715DBB4a90F317c6ca81dF2d8396a9 --value 1000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x1e8B446Ab2206445Fdb1F0458148e8D7d3Ec6399 --value 1000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545


# 0x5FbDB2315678afecb367f032d93F642f64180aa3 deploy by deploy_erc20.sh
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545

cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0xa4eEB3c8310A8dea738173c50DaE01F1E3A68B44 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0x3C4383598A2094dc52aCba411DE7bA0b32Adb4E9 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0x972edE2A6BD7b6Ea46E3981006D499dAf726bf9e 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0x33633C5056715DBB4a90F317c6ca81dF2d8396a9 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "transfer(address to, uint256 value)" 0x1e8B446Ab2206445Fdb1F0458148e8D7d3Ec6399 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545



# 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 deploy by deploy_erc20.sh
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 80000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545

cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x3C4383598A2094dc52aCba411DE7bA0b32Adb4E9 900000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0xd8fbBF32Be3b93F4Dc4242C7c1B172335581B534 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x36c3638114334Ac63465466424aF0205aEB41D37 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0xC0ac046EF6a2446EBEf325522115E1C6E5AC9E05 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x72851d9F59F27FAFAdfdF739Ea3DdB74D8FDbd2E 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x7Af461Ef23914f581AD5e65d000783e215907100 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x7Af461Ef23914f581AD5e65d000783e215907100 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x7Af461Ef23914f581AD5e65d000783e215907100 1000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545

# mock backlist  0x70997970C51812dc3A010C7d01b50e0d17dc79C8  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
# // user/1/address?chain_type=evm
cast send 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 --value 250000000000000000 --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 300000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0xF4A4378A91d7aFb2EC4a1bf5d80a21ae87C15e44 300000000000000000000 --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d --rpc-url http://127.0.0.1:8545

# // /user/2/address?chain_type=evm
cast send 0x3C4383598A2094dc52aCba411DE7bA0b32Adb4E9 --value 250000000000000000 --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 300000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url http://127.0.0.1:8545
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "transfer(address to, uint256 value)" 0x3C4383598A2094dc52aCba411DE7bA0b32Adb4E9 300000000000000000000 --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d --rpc-url http://127.0.0.1:8545

# mint a normal block

# 执行10次转账
for i in {1..10}; do
    echo "执行第 $i 次转账..."
    cast send 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f --value 1000000000000000 --private-key 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 --rpc-url http://127.0.0.1:8545
    echo "第 $i 次转账完成"
    echo "---"
done
