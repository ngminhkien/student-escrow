import { artifacts } from "hardhat";
import { writeFile } from "node:fs/promises";

const artifact = await artifacts.readArtifact("Escrow");
await writeFile(new URL("Escrow.abi.json", import.meta.url), JSON.stringify(artifact.abi, null, 2) + "\n");
console.log("Exported deployment/Escrow.abi.json from compiled Escrow.");
