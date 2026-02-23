import { FIXED_TOPICS } from "../src/game/constants.js";

const asJson = process.argv.includes("--json");

if (asJson) {
  process.stdout.write(`${JSON.stringify(FIXED_TOPICS, null, 2)}\n`);
  process.exit(0);
}

console.log("Twitter返答ゲーム向け お題例");
console.log("--------------------------------");
FIXED_TOPICS.forEach((topic, index) => {
  console.log(`${index + 1}. ${topic}`);
});
console.log("--------------------------------");
console.log("JSONで出力: npm run topics:examples -- --json");
