import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  const applicant = await prisma.user.upsert({
    where: { email: "applicant@example.com" },
    update: {},
    create: {
      email: "applicant@example.com",
      name: "Alice Applicant",
      role: "APPLICANT",
      passwordHash: password,
    },
  });

  const applicant2 = await prisma.user.upsert({
    where: { email: "applicant2@example.com" },
    update: {},
    create: {
      email: "applicant2@example.com",
      name: "Bob Applicant",
      role: "APPLICANT",
      passwordHash: password,
    },
  });

  const reviewer = await prisma.user.upsert({
    where: { email: "reviewer@example.com" },
    update: {},
    create: {
      email: "reviewer@example.com",
      name: "Rachel Reviewer",
      role: "REVIEWER",
      passwordHash: password,
    },
  });

  // A draft, untouched.
  await prisma.application.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      title: "New laptop request",
      category: "EQUIPMENT",
      description: "Current laptop is 5 years old and struggling with the build pipeline.",
      amount: 1800,
      applicantId: applicant.id,
      status: "DRAFT",
    },
  });

  // A submitted application sitting in the reviewer queue.
  const submitted = await prisma.application.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      title: "Annual leave - 3 days",
      category: "LEAVE",
      description: "Requesting 3 days off for a family event.",
      dueDate: new Date("2026-08-01"),
      applicantId: applicant.id,
      status: "SUBMITTED",
    },
  });
  await prisma.auditLog.upsert({
    where: { id: "00000000-0000-0000-0000-000000000010" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000010",
      applicationId: submitted.id,
      actorId: applicant.id,
      fromStatus: "DRAFT",
      toStatus: "SUBMITTED",
      comment: null,
    },
  });

  // A second applicant's draft, to test cross-user ownership rules.
  await prisma.application.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      title: "Conference travel - DevCon 2026",
      category: "TRAVEL",
      description: "Round-trip flight and 2 nights' accommodation.",
      amount: 950,
      applicantId: applicant2.id,
      status: "DRAFT",
    },
  });

  // A batch of additional submitted/under-review applications purely so
  // the reviewer queue's pagination and search have something real to
  // page/filter through beyond a single item.
  const bulkTitles: { title: string; category: "EXPENSE" | "LEAVE" | "EQUIPMENT" | "TRAVEL" | "OTHER"; status: "SUBMITTED" | "UNDER_REVIEW"; applicant: typeof applicant }[] = [
    { title: "Client dinner reimbursement", category: "EXPENSE", status: "SUBMITTED", applicant },
    { title: "Standing desk request", category: "EQUIPMENT", status: "SUBMITTED", applicant: applicant2 },
    { title: "Sick leave - 2 days", category: "LEAVE", status: "UNDER_REVIEW", applicant },
    { title: "Team offsite travel - Livingstone", category: "TRAVEL", status: "SUBMITTED", applicant: applicant2 },
    { title: "Monitor upgrade", category: "EQUIPMENT", status: "SUBMITTED", applicant },
    { title: "Training course - AWS certification", category: "OTHER", status: "UNDER_REVIEW", applicant: applicant2 },
    { title: "Internet reimbursement - June", category: "EXPENSE", status: "SUBMITTED", applicant },
    { title: "Paternity leave", category: "LEAVE", status: "SUBMITTED", applicant: applicant2 },
    { title: "Replacement keyboard", category: "EQUIPMENT", status: "SUBMITTED", applicant },
    { title: "Site visit travel - Ndola", category: "TRAVEL", status: "UNDER_REVIEW", applicant: applicant2 },
    { title: "Software license renewal", category: "OTHER", status: "SUBMITTED", applicant },
    { title: "Annual leave - 5 days", category: "LEAVE", status: "SUBMITTED", applicant: applicant2 },
  ];

  for (let i = 0; i < bulkTitles.length; i++) {
    const item = bulkTitles[i];
    const id = `00000000-0000-0000-0000-0000000001${String(i + 1).padStart(2, "0")}`;
    await prisma.application.upsert({
      where: { id },
      update: {},
      create: {
        id,
        title: item.title,
        category: item.category,
        description: `Seed data sample application: ${item.title}.`,
        applicantId: item.applicant.id,
        status: item.status,
      },
    });
  }

  console.log("Seed complete.");
  console.log("Login credentials (password for all: password123):");
  console.log(`  Applicant: ${applicant.email}`);
  console.log(`  Applicant: ${applicant2.email}`);
  console.log(`  Reviewer:  ${reviewer.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
