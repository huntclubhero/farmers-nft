// Generate 200 unguessable claim tokens (one per hat) and the corresponding
// (tokenHash, spriteId) seed arrays for HatPet.seedTokens().
//
// Output files:
//   out/tokens.json           : { uid, claimToken, claimUrl, spriteId } per hat (KEEP PRIVATE)
//   out/seed.json             : { hashes: bytes32[], spriteIds: uint16[] } for the contract
//   out/urls.txt              : one claim URL per line, in UID order (for distribution)
//   out/attributes-seed.json  : { spriteIds: uint16[], attributesJson: string[] } for HatPet.seedSpriteAttributes()
//
// Edit BASE_URL and UID_FILE before running. UID_FILE is plain text with one UID per line.
// If you do not have real UIDs yet, leave UID_FILE undefined and 200 placeholder UIDs are used.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { keccak256, getBytes, hexlify } = require("ethers");

const BASE_URL = process.env.CLAIM_BASE_URL || "https://your-claim-site.app/c";
const UID_FILE = process.env.UID_FILE || null;
const COUNT = 200;

const OUT = path.resolve(__dirname, "..", "out");
fs.mkdirSync(OUT, { recursive: true });

function loadUids() {
  if (UID_FILE && fs.existsSync(UID_FILE)) {
    const lines = fs.readFileSync(UID_FILE, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < COUNT) {
      console.warn(`Only ${lines.length} UIDs in ${UID_FILE}, padding with placeholders.`);
      while (lines.length < COUNT) lines.push(`placeholder-${lines.length}`);
    }
    return lines.slice(0, COUNT);
  }
  console.warn("No UID_FILE set, generating placeholder UIDs.");
  return Array.from({ length: COUNT }, (_, i) => `placeholder-${String(i).padStart(3, "0")}`);
}

function randomToken() {
  // 32 unguessable bytes per claim token, hex encoded for the URL.
  return "0x" + crypto.randomBytes(32).toString("hex");
}

function main() {
  const uids = loadUids();
  const rows = uids.map((uid, i) => {
    const claimToken = randomToken();
    const tokenHash = keccak256(getBytes(claimToken));
    return {
      uid,
      spriteId: i,
      claimToken,
      tokenHash,
      claimUrl: `${BASE_URL}/${claimToken.slice(2)}`,
    };
  });

  fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(rows, null, 2));
  fs.writeFileSync(
    path.join(OUT, "seed.json"),
    JSON.stringify(
      {
        hashes: rows.map(r => r.tokenHash),
        spriteIds: rows.map(r => r.spriteId),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(OUT, "urls.txt"), rows.map(r => r.claimUrl).join("\n"));

  // Build the OpenSea attributes seed from the sprite generator output (if present).
  const attributesPath = path.join(OUT, "attributes.json");
  let attributesSeedWritten = false;
  if (fs.existsSync(attributesPath)) {
    const raw = JSON.parse(fs.readFileSync(attributesPath, "utf8"));
    // Accept either { "0": [...], "1": [...] } keyed by spriteId, or an array indexed by spriteId.
    const spriteIds = [];
    const attributesJson = [];
    for (let i = 0; i < COUNT; i++) {
      let attrs;
      if (Array.isArray(raw)) {
        attrs = raw[i];
      } else if (raw && typeof raw === "object") {
        attrs = raw[i] !== undefined ? raw[i] : raw[String(i)];
      }
      if (attrs === undefined || attrs === null) continue;
      spriteIds.push(i);
      attributesJson.push(typeof attrs === "string" ? attrs : JSON.stringify(attrs));
    }
    fs.writeFileSync(
      path.join(OUT, "attributes-seed.json"),
      JSON.stringify({ spriteIds, attributesJson }, null, 2),
    );
    attributesSeedWritten = true;
  } else {
    console.warn(`WARNING: ${attributesPath} not found; skipping out/attributes-seed.json.`);
    console.warn("         Run the sprite generator first, then re-run this script to emit attribute seeds.");
  }

  console.log(`Generated ${rows.length} tokens.`);
  console.log(`  out/tokens.json          (private: UID, token, URL per hat)`);
  console.log(`  out/seed.json            (eligibility hashes + spriteIds for HatPet.seedTokens)`);
  console.log(`  out/urls.txt             (claim URLs in UID order)`);
  if (attributesSeedWritten) {
    console.log(`  out/attributes-seed.json (per-sprite OpenSea attributes for HatPet.seedSpriteAttributes)`);
  } else {
    console.log(`  out/attributes-seed.json (SKIPPED: out/attributes.json missing)`);
  }
  console.log("");
  console.log("NEVER commit out/tokens.json or out/urls.txt to a public repo.");
}

main();
