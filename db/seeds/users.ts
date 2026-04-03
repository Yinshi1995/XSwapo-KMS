import db from "../index"
import { SecurePassword } from "@blitzjs/auth/secure-password"

export async function seedUsers() {
  const password = "admin123"
  const hashedPassword = await SecurePassword.hash(password)

  await db.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN",
      hashedPassword,
    },
  })
}
