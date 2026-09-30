// Upgrade the HatPet implementation behind the existing UUPS proxy.
// Drop a new contract (e.g. HatPetV2.sol) into ./contracts/ first.
//
// Run:
//   NEW_CONTRACT=HatPetV2 npx hardhat run scripts/upgrade.js --network base

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const DEPLOYED = path.resolve(__dirname, "..", "deployed.json");
  if (!fs.existsSync(DEPLOYED)) throw new Error("deployed.json missing.");
  const { proxy } = JSON.parse(fs.readFileSync(DEPLOYED, "utf8"));
  const newContract = process.env.NEW_CONTRACT;
  if (!newContract) throw new Error("Set NEW_CONTRACT=YourV2ContractName");

  console.log(`Upgrading proxy ${proxy} -> ${newContract}`);
  const factory = await hre.ethers.getContractFactory(newContract);
  const upgraded = await hre.upgrades.upgradeProxy(proxy, factory);
  await upgraded.waitForDeployment();
  const newImpl = await hre.upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`New implementation: ${newImpl}`);
}

main().catch(e => { console.error(e); process.exit(1); });
