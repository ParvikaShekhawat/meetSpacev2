import { io } from "socket.io-client";

const BASE_URL = "http://localhost:5000";

async function login(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data.token as string;
}

async function main() {
  console.log("Logging in as interviewer...");
  const token = await login("interviewer@meetspace.com", "interviewer123");
  const authHeaders = { Authorization: `Bearer ${token}` };

  console.log("Fetching interviews...");
  const listRes = await fetch(`${BASE_URL}/api/interviews`, { headers: authHeaders });
  const interviews = await listRes.json();
  const target = interviews.find((iv: any) => iv.code === "INT-9001");
  if (!target) throw new Error("Could not find seeded interview INT-9001");
  console.log(`Found interview ${target.id}, status=${target.status}`);

  if (target.status === "SCHEDULED") {
    console.log("Starting interview...");
    const startRes = await fetch(`${BASE_URL}/api/interviews/${target.id}/start`, {
      method: "POST",
      headers: authHeaders,
    });
    if (!startRes.ok) throw new Error(`Failed to start: ${JSON.stringify(await startRes.json())}`);
  }

  const detailRes = await fetch(`${BASE_URL}/api/interviews/${target.id}`, { headers: authHeaders });
  const detail = await detailRes.json();
  const firstQuestion = detail.questions[0];

  console.log("Connecting via Socket.io (interviewer)...");
  const interviewerSocket = io(BASE_URL, { path: "/api/socket", auth: { token } });
  await new Promise<void>((resolve, reject) => {
    interviewerSocket.on("connect", () => resolve());
    interviewerSocket.on("connect_error", (err) => reject(err));
  });
  interviewerSocket.emit("join-room", { interviewId: target.id });
  await new Promise((r) => setTimeout(r, 1000));

  // Second socket connection to listen for the broadcast (since the sender doesn't get their own broadcast back)
  const listenerSocket = io(BASE_URL, { path: "/api/socket", auth: { token } });
  await new Promise<void>((resolve, reject) => {
    listenerSocket.on("connect", () => resolve());
    listenerSocket.on("connect_error", (err) => reject(err));
  });
  listenerSocket.emit("join-room", { interviewId: target.id });
  await new Promise((r) => setTimeout(r, 1000));

  let received: any = null;
  listenerSocket.on("flag-recorded", (data) => {
    received = data;
    console.log("Received flag-recorded broadcast:", data);
  });

  console.log("Sending a VALID flag (STRONG_ANSWER)...");
  interviewerSocket.emit("flag-event", {
    flagType: "STRONG_ANSWER",
    questionId: firstQuestion.questionId,
    note: "Test note for valid flag",
  });

  await new Promise((r) => setTimeout(r, 2000));

  if (received && received.flagType === "STRONG_ANSWER") {
    console.log("✅ Valid flag was broadcast correctly.");
  } else {
    console.log("❌ Valid flag was NOT received — something is wrong.");
  }

  received = null;
  console.log("Sending an INVALID flag (MADE_UP_TYPE) — should be silently rejected...");
  interviewerSocket.emit("flag-event", {
    flagType: "MADE_UP_TYPE",
    questionId: firstQuestion.questionId,
    note: "This should not be saved",
  });

  await new Promise((r) => setTimeout(r, 2000));

  if (received === null) {
    console.log("✅ Invalid flag was correctly rejected (no broadcast received).");
  } else {
    console.log("❌ Invalid flag was NOT rejected — something is wrong.");
  }

  interviewerSocket.disconnect();
  listenerSocket.disconnect();

  console.log("\nDone. Now check Prisma Studio -> InterviewEvent table:");
  console.log(`Interview ID: ${target.id}`);
  console.log(`Expect exactly ONE row with type=FLAG and flagType=STRONG_ANSWER`);
  console.log(`Expect NO row with the invalid flag type — it should not exist at all`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});