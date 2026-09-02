import nodemailer from "nodemailer";
import { config } from "../config/env";

const transporter = nodemailer.createTransport({
  host: config.smtp.host || "smtp.ethereal.email",
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

const isMockMode = !config.smtp.user;

export async function sendInterviewInvite(params: {
  to: string;
  candidateName: string;
  positionTitle: string;
  scheduledAt: Date;
  durationMins: number;
  interviewCode: string;
  interviewId: string;
}) {
  if (isMockMode) {
    console.log(`[Email Mock] Invite to ${params.to} for ${params.positionTitle} (Code: ${params.interviewCode})`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"MeetSpace" <${config.smtp.from}>`,
      to: params.to,
      subject: `Interview Scheduled: ${params.positionTitle}`,
      html: `
        <h2>MeetSpace Technical Interview</h2>
        <p>Hi ${params.candidateName},</p>
        <p>Your interview for <strong>${params.positionTitle}</strong> has been scheduled for <strong>${params.scheduledAt.toLocaleString()}</strong> (${params.durationMins} mins).</p>
        <p>Interview Code: <strong>${params.interviewCode}</strong></p>
        <p><a href="${config.clientUrl}/login">Click here to log in to MeetSpace</a></p>
      `,
    });
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }
}

export async function sendCandidateCredentials(params: {
  to: string;
  candidateName: string;
  email: string;
  temporaryPassword: string;
  positionTitle: string;
}) {
  if (isMockMode) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Email Mock] Credentials to ${params.to}: Temp password: ${params.temporaryPassword}`);
    } else {
      console.log(`[Email Mock] Credentials generated for ${params.to} (password not logged in production)`);
    }
    return;
  }

  try {
    await transporter.sendMail({
      from: `"MeetSpace" <${config.smtp.from}>`,
      to: params.to,
      subject: `Your MeetSpace Account Credentials`,
      html: `
        <h2>Welcome to MeetSpace</h2>
        <p>Hi ${params.candidateName},</p>
        <p>An interviewer added you for the <strong>${params.positionTitle}</strong> position.</p>
        <p>Email: <strong>${params.email}</strong><br/>Temporary Password: <strong>${params.temporaryPassword}</strong></p>
        <p><a href="${config.clientUrl}/login">Click here to log in to MeetSpace</a></p>
      `,
    });
  } catch (err) {
    console.error("Failed to send credentials email:", err);
  }
}

export async function sendVerificationEmail(params: {
  to: string;
  candidateName: string;
  token: string;
}) {
  const verifyUrl = `${config.clientUrl}/verify-email?token=${params.token}`;

  if (isMockMode) {
    console.log(`[Email Mock] Verification link for ${params.to}: ${verifyUrl}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"MeetSpace" <${config.smtp.from}>`,
      to: params.to,
      subject: `Verify your MeetSpace email`,
      html: `
        <h2>Verify your email</h2>
        <p>Hi ${params.candidateName},</p>
        <p>Please confirm this email address belongs to you before joining an interview on MeetSpace.</p>
        <p><a href="${verifyUrl}">Click here to verify your email</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    });
  } catch (err) {
    console.error("Failed to send verification email:", err);
  }
}