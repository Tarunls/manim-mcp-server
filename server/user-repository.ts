import type { AuthUser } from "./auth-service.js";
import { Database } from "./database.js";

export class UserRepository {
  constructor(private readonly database: Database) {}

  async syncIdentity(user: AuthUser) {
    if (!this.database.configured) return;
    await this.database.query(
      `INSERT INTO app_users (id, email, email_verified, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         email_verified = EXCLUDED.email_verified,
         role = EXCLUDED.role,
         updated_at = now(),
         deleted_at = NULL`,
      [user.uid, user.email, user.emailVerified, user.isStaff ? "staff" : "user"],
    );
  }
}
