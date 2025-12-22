import type { Context } from 'hono';
import { UserService } from '../../services/UserService';

export async function listUsers(c: Context): Promise<Response> {
    const db = c.get('database');
    const userService = new UserService(db);

    // Check permissions (must be admin)
    const session = c.get('session');
    if (session.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
    }

    const users = await userService.list();
    return c.json({ users });
}

export async function createUser(c: Context): Promise<Response> {
    const db = c.get('database');
    const userService = new UserService(db);

    // Check permissions
    const session = c.get('session');
    if (session.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
    }

    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { email, password, role } = body;

    // Password is now optional for invites
    if (!email) {
        return c.json({ error: 'Email is required' }, 400);
    }

    try {
        const user = await userService.create({
            email,
            password,
            role: role || 'viewer',
        });

        // Send invite email if SMTP is configured
        if (c.env.SMTP_HOST && c.env.SMTP_USER && c.env.SMTP_PASS) {
            try {
                const { EmailService } = await import('../../services/EmailService');
                const emailService = new EmailService({
                    host: c.env.SMTP_HOST,
                    port: parseInt(c.env.SMTP_PORT || '587'),
                    user: c.env.SMTP_USER,
                    pass: c.env.SMTP_PASS,
                    from: c.env.SMTP_FROM || c.env.SMTP_USER,
                });

                let subject = 'Welcome to Composer Proxy';
                let text = '';
                let html = '';

                if (user?.invite_token) {
                    // Invite Flow
                    const origin = c.req.header('origin') || new URL(c.req.url).origin;
                    const inviteLink = `${origin}/invite/${user.invite_token}`;

                    text = `You have been invited to the Composer Proxy.\n\nPlease accept the invitation and set your password here:\n${inviteLink}`;
                    html = `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
                            <h2 style="color: #0f172a;">Welcome to Composer Proxy</h2>
                            <p>You have been invited to join the Composer Proxy.</p>
                            <p>Please click the button below to accept the invitation and set your password:</p>
                            <p style="margin: 24px 0;">
                                <a href="${inviteLink}" style="background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Accept Invitation</a>
                            </p>
                            <p style="font-size: 0.9em; color: #64748b;">Or copy this link to your browser: <br> ${inviteLink}</p>
                            <p style="font-size: 0.8em; color: #94a3b8; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
                                This invite expires in 7 days.
                            </p>
                        </div>
                    `;
                } else if (password) {
                    // Legacy/Manual Password Flow (if admin provided password)
                    text = `You have been invited to the Composer Proxy.\n\nYour temporary password is: ${password}\n\nPlease log in and change your password immediately.`;
                    html = `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
                            <h2>Welcome to Composer Proxy</h2>
                            <p>You have been invited to the Composer Proxy.</p>
                            <p>Your temporary password is: <strong>${password}</strong></p>
                            <p>Please log in and change your password immediately.</p>
                        </div>
                    `;
                }

                if (text && html) {
                    await emailService.send({ to: email, subject, text, html });
                }

            } catch (emailError) {
                console.error('Failed to send invite email:', emailError);
            }
        }

        return c.json({
            message: 'User created',
            user: {
                id: user?.id,
                email: user?.email,
                role: user?.role
            }
        });
    } catch (error: any) {
        if (error.message === 'User already exists') {
            return c.json({ error: 'User already exists' }, 409);
        }
        return c.json({ error: 'Failed to create user' }, 500);
    }
}

export async function deleteUser(c: Context): Promise<Response> {
    const db = c.get('database');
    const userService = new UserService(db);
    const userId = c.req.param('id');

    // Check permissions
    const session = c.get('session');
    if (session.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
    }

    // Prevent self-deletion
    if (session.userId === userId) {
        return c.json({ error: 'Cannot delete own account' }, 400);
    }

    await userService.delete(userId);
    return c.json({ message: 'User deleted' });
}
