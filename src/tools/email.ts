import nodemailer from "nodemailer";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function registerEmailTools(server: McpServer) {
  server.registerTool(
    "send_email",
    {
      title: "Send Email",
      description:
        "Send an email via the Mailcow SMTP server. " +
        "FROM is always storm@kroon-en.nl (public) or stormkroonen@hotmail.nl (personal). " +
        "Always confirm content with the user before sending.",
      inputSchema: {
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Plain text email body"),
        from: z
          .enum(["storm@kroon-en.nl", "stormkroonen@hotmail.nl"])
          .default("storm@kroon-en.nl")
          .describe(
            "Sender address: storm@kroon-en.nl (public/stage) or stormkroonen@hotmail.nl (personal)"
          ),
        replyTo: z
          .string()
          .optional()
          .describe("Optional reply-to address"),
      },
    },
    async ({ to, subject, body, from, replyTo }) => {
      await transporter.sendMail({
        from: `Storm Kroonen <${from}>`,
        to,
        subject,
        text: body,
        replyTo: replyTo ?? "stormkroonen@hotmail.nl",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Email verstuurd naar ${to} via ${from}.\nOnderwerp: ${subject}`,
          },
        ],
      };
    }
  );
}
