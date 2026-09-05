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

  console.log("Fetching interviews...");
  const listRes = await fetch(`${BASE_URL}/api/interviews`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const interviews = await listRes.json();
  const target = interviews.find((iv: any) => iv.code === "INT-9001");
  if (!target) throw new Error("Could not find seeded interview INT-9001");
  console.log(`Found interview ${target.id}, status=${target.status}`);

  if (target.status === "SCHEDULED") {
    console.log("Starting interview...");
    const startRes = await fetch(`${BASE_URL}/api/interviews/${target.id}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!startRes.ok) throw new Error(`Failed to start: ${JSON.stringify(await startRes.json())}`);
  }

  const detailRes = await fetch(`${BASE_URL}/api/interviews/${target.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailRes.json();
  const questions = detail.questions.sort((a: any, b: any) => a.order - b.order);
  if (questions.length < 2) throw new Error("Need at least 2 questions on this interview to test switching");

  console.log("Connecting via Socket.io...");
  const socket = io(BASE_URL, { path: "/api/socket", auth: { token } });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
  });
  console.log("Socket connected. Joining room...");
  socket.emit("join-room", { interviewId: target.id });
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`Switching to Q1 (${questions[0].question.title})...`);
  socket.emit("question-switch", {
    questionIdx: 0,
    questionId: questions[0].questionId,
    title: questions[0].question.title,
  });

  console.log("Waiting 5s on Q1...");
  await new Promise((r) => setTimeout(r, 5000));

  console.log(`Switching to Q2 (${questions[1].question.title})...`);
  socket.emit("question-switch", {
    questionIdx: 1,
    questionId: questions[1].questionId,
    title: questions[1].question.title,
  });

  console.log("Waiting 3s on Q2 (this one should close via /end, not question-switch)...");
  await new Promise((r) => setTimeout(r, 3000));

  socket.disconnect();

  console.log("Ending interview...");
  const endRes = await fetch(`${BASE_URL}/api/interviews/${target.id}/end`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!endRes.ok) throw new Error(`Failed to end: ${JSON.stringify(await endRes.json())}`);

  console.log("Done. Now check Prisma Studio -> InterviewQuestion rows for this interview:");
  console.log(`Interview ID: ${target.id}`);
  console.log(`Expect Q1 (${questions[0].question.title}) timeSpentSecs ~5`);
  console.log(`Expect Q2 (${questions[1].question.title}) timeSpentSecs ~3`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});