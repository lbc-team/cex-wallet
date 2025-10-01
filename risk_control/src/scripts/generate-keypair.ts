import { Ed25519Signer } from '../utils/crypto';

console.log('\n=== Risk Control Service - Key Pair Generator ===\n');

const keyPair = Ed25519Signer.generateKeyPair();

console.log('✅ New Ed25519 key pair generated successfully!\n');
console.log('📋 Copy these values to your .env file:\n');
console.log('Public Key (share with db_gateway):');
console.log(`RISK_PUBLIC_KEY=${keyPair.publicKey}\n`);
console.log('Private Key (keep SECRET in risk_control service):');
console.log(`RISK_PRIVATE_KEY=${keyPair.privateKey}\n`);
console.log('⚠️  WARNING: Never commit the private key to version control!');
console.log('⚠️  Store the private key securely (e.g., environment variables, secret manager)\n');
