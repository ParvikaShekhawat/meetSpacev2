import { generateReportWithAI } from "../src/services/openai.service";

async function main() {
  const result = await generateReportWithAI({
    candidateName: "Test Candidate",
    positionTitle: "Backend Engineer",
    durationMins: 45,
    events: [
      { type: "HINT", timestampMs: 60000, payload: { text: "Consider using a hashmap for O(1) lookups" } },
      { type: "FLAG", timestampMs: 120000, payload: { flag: "Good Insight" } },
      { type: "CODE_CHANGE", timestampMs: 180000, payload: {} },
      { type: "NOTE", timestampMs: 200000, payload: { text: "Communication was clear throughout" } },
    ],
    questions: [
      { title: "Two Sum", type: "CODING", finalCode: "function twoSum(nums, target) { const map = new Map(); for (let i = 0; i < nums.length; i++) { if (map.has(target - nums[i])) return [map.get(target - nums[i]), i]; map.set(nums[i], i); } }" },
    ],
  });

  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });