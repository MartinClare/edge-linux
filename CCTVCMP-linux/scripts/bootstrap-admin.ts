import { PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";

const email = process.env.CMP_BOOTSTRAP_EMAIL?.trim();
const password = process.env.CMP_BOOTSTRAP_PASSWORD;
const name = (process.env.CMP_BOOTSTRAP_NAME || "Admin").trim();

if (!email || !password) {
  console.error(
    "Set CMP_BOOTSTRAP_EMAIL and CMP_BOOTSTRAP_PASSWORD in .env (or export them), then run:\n" +
      "  npm run bootstrap-admin",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { hashedPassword, name, role: Role.admin },
    create: { email, name, hashedPassword, role: Role.admin },
  });
  console.log(`Admin user ready: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
