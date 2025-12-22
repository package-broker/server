
import { type Database } from '../db';
import { users } from '../db/schema';
import { eq, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type CreateUserParams = {
    email: string;
    password?: string; // Optional if using external auth later, but required for now
    role?: 'admin' | 'viewer';
};

export class UserService {
    constructor(private db: Database) { }

    private async hashPassword(password: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hash = sha256(data);
        return bytesToHex(hash);
    }

    async create(params: CreateUserParams) {
        // Check if user exists
        const existing = await this.findByEmail(params.email);
        if (existing) {
            throw new Error("User already exists");
        }

        const id = nanoid();
        let passwordHash: string;
        let status = 'active';
        let inviteToken: string | null = null;
        let inviteExpiresAt: number | null = null;

        if (params.password) {
            passwordHash = await this.hashPassword(params.password);
        } else {
            // Invite flow
            passwordHash = 'invited';
            status = 'invited';
            inviteToken = nanoid(32);
            inviteExpiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days
        }

        await this.db.insert(users).values({
            id,
            email: params.email.toLowerCase(),
            password_hash: passwordHash,
            role: params.role || 'admin',
            status,
            invite_token: inviteToken,
            invite_expires_at: inviteExpiresAt,
            created_at: Math.floor(Date.now() / 1000),
        });

        return this.findById(id);
    }

    async findByEmail(email: string) {
        return this.db.query.users.findFirst({
            where: eq(users.email, email.toLowerCase()),
        });
    }

    async findById(id: string) {
        return this.db.query.users.findFirst({
            where: eq(users.id, id),
        });
    }

    async verifyCredentials(email: string, password: string) {
        const user = await this.findByEmail(email);
        if (!user) return null;

        const inputHash = await this.hashPassword(password);
        if (inputHash === user.password_hash) {
            // Update last login
            await this.db.update(users)
                .set({ last_login_at: Math.floor(Date.now() / 1000) })
                .where(eq(users.id, user.id));
            return user;
        }
        return null;
    }

    async count() {
        const result = await this.db.select({ count: count(users.id) }).from(users);
        return result[0].count;
    }

    async list() {
        return this.db.select({
            id: users.id,
            email: users.email,
            role: users.role,
            status: users.status,
            created_at: users.created_at,
            last_login_at: users.last_login_at,
        }).from(users).orderBy(users.created_at);
    }

    async delete(id: string) {
        return this.db.delete(users).where(eq(users.id, id));
    }

    // 2FA Methods

    async setupTwoFactor(userId: string) {
        const secret = (await import('otplib')).authenticator.generateSecret();
        // Just return secret, don't save yet until verified
        return secret;
    }

    async generateTwoFactorQrCode(email: string, secret: string) {
        const otpauth = (await import('otplib')).authenticator.keyuri(email, 'Cloudflare Composer Proxy', secret);
        return (await import('qrcode')).toDataURL(otpauth);
    }

    async enableTwoFactor(userId: string, secret: string, token: string) {
        // Verify token first
        const isValid = await this.verifyTwoFactorToken(secret, token);
        if (!isValid) {
            throw new Error('Invalid 2FA token');
        }

        // Generate recovery codes
        const recoveryCodes = Array.from({ length: 8 }, () => nanoid(10)); // 8 codes, 10 chars each

        await this.db.update(users)
            .set({
                two_factor_secret: secret,
                two_factor_enabled: true,
                recovery_codes: JSON.stringify(recoveryCodes)
            })
            .where(eq(users.id, userId));

        return recoveryCodes;
    }

    async verifyTwoFactorToken(secret: string, token: string) {
        return (await import('otplib')).authenticator.verify({ token, secret });
    }

    async disableTwoFactor(userId: string) {
        await this.db.update(users)
            .set({
                two_factor_secret: null,
                two_factor_enabled: false,
                recovery_codes: null
            })
            .where(eq(users.id, userId));
    }

    async validateTwoFactorLogin(userId: string, token: string) {
        const user = await this.findById(userId);
        if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
            return false;
        }

        return this.verifyTwoFactorToken(user.two_factor_secret, token);
    }

    // Invite Methods

    async findByInviteToken(token: string) {
        return this.db.query.users.findFirst({
            where: eq(users.invite_token, token),
        });
    }

    async acceptInvite(token: string, password: string) {
        const user = await this.findByInviteToken(token);
        if (!user) {
            throw new Error('Invalid invite token');
        }

        if (user.invite_expires_at && user.invite_expires_at < Math.floor(Date.now() / 1000)) {
            throw new Error('Invite expired');
        }

        const passwordHash = await this.hashPassword(password);

        await this.db.update(users)
            .set({
                password_hash: passwordHash,
                invite_token: null,
                invite_expires_at: null,
                status: 'active',
                last_login_at: Math.floor(Date.now() / 1000)
            })
            .where(eq(users.id, user.id));

        return user;
    }
}
