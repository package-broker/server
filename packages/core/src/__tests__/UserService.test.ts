
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../services/UserService';
import { createD1Database as createDatabase } from '../db';

vi.mock('../db');

describe('UserService', () => {
    const mockDb = {
        query: {
            users: {
                findFirst: vi.fn(),
            },
        },
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        all: vi.fn(),
        delete: vi.fn().mockReturnThis(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (createDatabase as any).mockReturnValue(mockDb);
    });

    it('should create a new user', async () => {
        // Mock findByEmail to return null (user doesn't exist)
        mockDb.query.users.findFirst.mockResolvedValueOnce(null);

        // Mock findById for return value
        const newUser = { id: '123', email: 'test@example.com', role: 'admin' };
        mockDb.query.users.findFirst.mockResolvedValueOnce(newUser);

        const service = new UserService(mockDb as any);
        const result = await service.create({
            email: 'test@example.com',
            password: 'password123',
            role: 'admin'
        });

        expect(result).toEqual(newUser);
        expect(mockDb.insert).toHaveBeenCalled();
        expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
            email: 'test@example.com',
            role: 'admin',
            status: 'active'
        }));
    });

    it('should throw error if user already exists', async () => {
        mockDb.query.users.findFirst.mockResolvedValueOnce({ id: 'existing' });

        const service = new UserService(mockDb as any);

        await expect(service.create({
            email: 'test@example.com',
            password: 'password123'
        })).rejects.toThrow('User already exists');
    });

    it('should verify credentials successfully', async () => {
        // Mock user with known hash (sha256 of 'password123')
        // echo -n "password123" | shasum -a 256
        // ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f
        const passwordHash = 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f';

        mockDb.query.users.findFirst.mockResolvedValueOnce({
            id: '123',
            email: 'test@example.com',
            password_hash: passwordHash
        });

        const service = new UserService(mockDb as any);
        const user = await service.verifyCredentials('test@example.com', 'password123');

        expect(user).not.toBeNull();
        expect(user?.id).toBe('123');
        expect(mockDb.update).toHaveBeenCalled(); // Should update last login
    });

    it('should fail verification with wrong password', async () => {
        const passwordHash = 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f';

        mockDb.query.users.findFirst.mockResolvedValueOnce({
            id: '123',
            email: 'test@example.com',
            password_hash: passwordHash
        });

        const service = new UserService(mockDb as any);
        const user = await service.verifyCredentials('test@example.com', 'wrongpassword');

        expect(user).toBeNull();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should count users', async () => {
        mockDb.select.mockReturnThis();
        mockDb.from.mockReturnThis();
        // Return array like Drizzle does for .from().all() or await
        (mockDb.select as any).mockReturnValue({
            from: vi.fn().mockResolvedValue([{ count: 3 }])
        });

        const service = new UserService(mockDb as any);
        const count = await service.count();

        expect(count).toBe(3);
    });

    it('should list users', async () => {
        const mockUsers = [
            { id: '1', email: 'a@example.com' },
            { id: '2', email: 'b@example.com' }
        ];

        (mockDb.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(mockUsers)
            })
        });

        const service = new UserService(mockDb as any);
        const users = await service.list();

        expect(users).toHaveLength(2);
        expect(users[0].email).toBe('a@example.com');
    });

    it('should delete a user', async () => {
        mockDb.delete.mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined)
        });

        const service = new UserService(mockDb as any);
        await service.delete('123');

        expect(mockDb.delete).toHaveBeenCalled();
    });
});
