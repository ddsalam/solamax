#!/usr/bin/env node
// Generate API key unit baru + hash-nya. Key plaintext → config agent (mesin
// SPBU, gitignored). Hash → kolom unit.api_key_hash. Key TIDAK disimpan di mana
// pun selain output ini — catat sekali, atau generate ulang bila hilang.
import { createHash, randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(key, "utf8").digest("hex");

console.log(`API key (untuk config agent) : ${key}`);
console.log(`api_key_hash (untuk DB)      : ${hash}`);
console.log("");
console.log("SQL update unit yang sudah ada:");
console.log(`  UPDATE unit SET api_key_hash = '${hash}' WHERE code = '<kode-unit>';`);
